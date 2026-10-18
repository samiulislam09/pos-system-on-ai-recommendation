/**
 * OLAP cube definition over the `olap` star schema.
 *
 *   olap.fact_sales (grain: one row per day × product × store)
 *     ├── olap.dim_date      Year → Quarter → Month → Day
 *     ├── olap.dim_product   Category → Product
 *     └── olap.dim_location  Location type → Store
 *
 * Level and measure SQL are fixed strings picked from these maps by key, so a
 * query never interpolates user input — member values always go in as params.
 */

export const DIMENSIONS = {
  time: ["year", "quarter", "month", "day"],
  product: ["category", "product"],
  location: ["locationType", "store"],
} as const;

export type Dimension = keyof typeof DIMENSIONS;
export type Level = (typeof DIMENSIONS)[Dimension][number];

export const LEVELS: Record<Level, { dimension: Dimension; label: string; expr: string }> = {
  year: { dimension: "time", label: "Year", expr: "d.year::text" },
  quarter: { dimension: "time", label: "Quarter", expr: "(d.year || '-Q' || d.quarter)" },
  month: { dimension: "time", label: "Month", expr: "to_char(d.full_date, 'YYYY-MM')" },
  day: { dimension: "time", label: "Day", expr: "to_char(d.full_date, 'YYYY-MM-DD')" },
  category: { dimension: "product", label: "Category", expr: "p.category" },
  product: { dimension: "product", label: "Product", expr: "p.name" },
  locationType: { dimension: "location", label: "Location type", expr: "l.location_type" },
  store: { dimension: "location", label: "Store", expr: "l.name" },
};

export const LEVEL_KEYS = Object.keys(LEVELS) as [Level, ...Level[]];

export const MEASURES = {
  quantity: { label: "Units sold", expr: "SUM(f.quantity)" },
  revenue: { label: "Revenue", expr: "SUM(f.revenue)" },
  profit: { label: "Profit", expr: "SUM(f.revenue - f.cost)" },
} as const;

export type Measure = keyof typeof MEASURES;
export const MEASURE_KEYS = Object.keys(MEASURES) as [Measure, ...Measure[]];

export const STAR_SCHEMA_DDL = [
  `CREATE SCHEMA IF NOT EXISTS olap`,
  `CREATE TABLE IF NOT EXISTS olap.dim_date (
     date_key     INT PRIMARY KEY,
     full_date    DATE NOT NULL,
     day_of_month INT NOT NULL,
     month        INT NOT NULL,
     quarter      INT NOT NULL,
     year         INT NOT NULL,
     day_of_week  INT NOT NULL,
     is_weekend   BOOLEAN NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS olap.dim_product (
     product_id TEXT PRIMARY KEY,
     org_id     TEXT NOT NULL,
     sku        TEXT NOT NULL,
     name       TEXT NOT NULL,
     category   TEXT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS olap.dim_location (
     location_id   TEXT PRIMARY KEY,
     org_id        TEXT NOT NULL,
     code          TEXT NOT NULL,
     name          TEXT NOT NULL,
     location_type TEXT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS olap.fact_sales (
     org_id      TEXT NOT NULL,
     date_key    INT NOT NULL REFERENCES olap.dim_date(date_key),
     product_id  TEXT NOT NULL REFERENCES olap.dim_product(product_id) ON DELETE CASCADE,
     location_id TEXT NOT NULL REFERENCES olap.dim_location(location_id) ON DELETE CASCADE,
     quantity    INT NOT NULL,
     revenue     NUMERIC(14,2) NOT NULL,
     cost        NUMERIC(14,2) NOT NULL,
     PRIMARY KEY (date_key, product_id, location_id)
   )`,
  `CREATE INDEX IF NOT EXISTS fact_sales_org_idx ON olap.fact_sales (org_id)`,
  `CREATE TABLE IF NOT EXISTS olap.etl_runs (
     org_id       TEXT PRIMARY KEY,
     refreshed_at TIMESTAMPTZ NOT NULL,
     fact_rows    INT NOT NULL
   )`,
];

/** ETL: rebuild one organization's slice of the star schema from the POS tables. $1 = organization id. */
export const ETL_STATEMENTS = [
  `DELETE FROM olap.fact_sales WHERE org_id = $1`,
  `DELETE FROM olap.dim_product WHERE org_id = $1`,
  `DELETE FROM olap.dim_location WHERE org_id = $1`,
  `INSERT INTO olap.dim_product (product_id, org_id, sku, name, category)
   SELECT p.id, p."organizationId", p.sku, p.name, COALESCE(c.name, 'Uncategorized')
   FROM "Product" p
   LEFT JOIN "Category" c ON c.id = p."categoryId"
   WHERE p."organizationId" = $1`,
  `INSERT INTO olap.dim_location (location_id, org_id, code, name, location_type)
   SELECT l.id, l."organizationId", l.code, l.name, l.type::text
   FROM "Location" l
   WHERE l."organizationId" = $1`,
  `INSERT INTO olap.dim_date (date_key, full_date, day_of_month, month, quarter, year, day_of_week, is_weekend)
   SELECT DISTINCT
     to_char(d, 'YYYYMMDD')::int, d, EXTRACT(DAY FROM d)::int, EXTRACT(MONTH FROM d)::int,
     EXTRACT(QUARTER FROM d)::int, EXTRACT(YEAR FROM d)::int, EXTRACT(ISODOW FROM d)::int,
     EXTRACT(ISODOW FROM d) >= 6
   FROM (SELECT DATE(s."createdAt") AS d FROM "Sale" s WHERE s."organizationId" = $1) dates
   ON CONFLICT (date_key) DO NOTHING`,
  `INSERT INTO olap.fact_sales (org_id, date_key, product_id, location_id, quantity, revenue, cost)
   SELECT s."organizationId",
          to_char(DATE(s."createdAt"), 'YYYYMMDD')::int,
          si."productId",
          s."storeId",
          SUM(si.quantity)::int,
          SUM(si.total),
          SUM(si.quantity * p."costPrice")
   FROM "SaleItem" si
   JOIN "Sale" s ON s.id = si."saleId"
   JOIN "Product" p ON p.id = si."productId"
   WHERE s."organizationId" = $1 AND s.status = 'COMPLETED'
   GROUP BY 1, 2, 3, 4`,
];

export interface CubeQuery {
  measure: Measure;
  rows: Level;
  cols?: Level | null;
  filters: Array<{ level: Level; values: string[] }>;
}

/**
 * Builds the aggregate query. With a column level it groups by CUBE (row, col),
 * which returns every cell plus row totals, column totals and the grand total
 * in one pass; with rows only it uses ROLLUP (row) for the grand total.
 */
export function buildCubeSql(organizationId: string, q: CubeQuery) {
  const params: unknown[] = [organizationId];
  const where = ["f.org_id = $1"];
  for (const f of q.filters) {
    params.push(f.values);
    where.push(`${LEVELS[f.level].expr} = ANY($${params.length}::text[])`);
  }

  const row = LEVELS[q.rows].expr;
  const col = q.cols ? LEVELS[q.cols].expr : null;
  const measure = MEASURES[q.measure].expr;

  const sql = `SELECT
  ${row} AS row_member,
  ${col ?? "NULL"} AS col_member,
  ${measure} AS value,
  GROUPING(${row}) AS row_total,
  ${col ? `GROUPING(${col})` : "1"} AS col_total
FROM olap.fact_sales f
JOIN olap.dim_date d     ON d.date_key = f.date_key
JOIN olap.dim_product p  ON p.product_id = f.product_id
JOIN olap.dim_location l ON l.location_id = f.location_id
WHERE ${where.join("\n  AND ")}
GROUP BY ${col ? `CUBE ((${row}), (${col}))` : `ROLLUP ((${row}))`}
ORDER BY 1, 2`;

  return { sql, params };
}
