import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { invalidOperation } from "../common/errors";
import {
  ETL_STATEMENTS,
  LEVELS,
  STAR_SCHEMA_DDL,
  buildCubeSql,
  type CubeQuery,
  type Level,
} from "./olap.cube";

const MAX_COLUMNS = 40;

@Injectable()
export class OlapService {
  constructor(private readonly prisma: PrismaService) {}

  async status(organizationId: string) {
    await this.ensureSchema();
    const rows = await this.prisma.$queryRawUnsafe<{ refreshed_at: Date; fact_rows: number }[]>(
      `SELECT refreshed_at, fact_rows FROM olap.etl_runs WHERE org_id = $1`,
      organizationId,
    );
    const [counts] = await this.prisma.$queryRawUnsafe<Record<string, bigint>[]>(
      `SELECT
         (SELECT COUNT(*) FROM "Sale" WHERE "organizationId" = $1 AND status = 'COMPLETED') AS sales,
         (SELECT COUNT(*) FROM "SaleItem" si JOIN "Sale" s ON s.id = si."saleId"
            WHERE s."organizationId" = $1 AND s.status = 'COMPLETED') AS sale_items,
         (SELECT COUNT(*) FROM "Product" WHERE "organizationId" = $1) AS products,
         (SELECT COUNT(*) FROM "Location" WHERE "organizationId" = $1) AS locations,
         (SELECT COUNT(*) FROM olap.fact_sales WHERE org_id = $1) AS fact_sales,
         (SELECT COUNT(DISTINCT date_key) FROM olap.fact_sales WHERE org_id = $1) AS dim_date,
         (SELECT COUNT(*) FROM olap.dim_product WHERE org_id = $1) AS dim_product,
         (SELECT COUNT(*) FROM olap.dim_location WHERE org_id = $1) AS dim_location`,
      organizationId,
    );
    const n = (key: string) => Number(counts[key] ?? 0);
    return {
      refreshedAt: rows[0]?.refreshed_at ?? null,
      factRows: rows[0]?.fact_rows ?? 0,
      source: { sales: n("sales"), saleItems: n("sale_items"), products: n("products"), locations: n("locations") },
      warehouse: {
        factSales: n("fact_sales"),
        dimDate: n("dim_date"),
        dimProduct: n("dim_product"),
        dimLocation: n("dim_location"),
      },
    };
  }

  /** ETL: extract from the POS tables, transform to the star schema's grain, load. */
  async refresh(organizationId: string) {
    await this.ensureSchema();
    await this.prisma.$transaction(
      async (tx) => {
        for (const stmt of ETL_STATEMENTS) await tx.$executeRawUnsafe(stmt, organizationId);
        await tx.$executeRawUnsafe(
          `INSERT INTO olap.etl_runs (org_id, refreshed_at, fact_rows)
           SELECT $1, now(), COUNT(*) FROM olap.fact_sales WHERE org_id = $1
           ON CONFLICT (org_id) DO UPDATE SET refreshed_at = EXCLUDED.refreshed_at, fact_rows = EXCLUDED.fact_rows`,
          organizationId,
        );
      },
      { timeout: 120_000 },
    );
    return this.status(organizationId);
  }

  /** Distinct members of one level, for the slice/dice filter pickers. */
  async members(organizationId: string, level: Level) {
    await this.ensureSchema();
    const rows = await this.prisma.$queryRawUnsafe<{ member: string }[]>(
      `SELECT DISTINCT ${LEVELS[level].expr} AS member
       FROM olap.fact_sales f
       JOIN olap.dim_date d     ON d.date_key = f.date_key
       JOIN olap.dim_product p  ON p.product_id = f.product_id
       JOIN olap.dim_location l ON l.location_id = f.location_id
       WHERE f.org_id = $1
       ORDER BY 1`,
      organizationId,
    );
    return rows.map((r) => r.member);
  }

  async query(organizationId: string, q: CubeQuery) {
    if (q.cols && LEVELS[q.cols].dimension === LEVELS[q.rows].dimension) {
      throw invalidOperation("Rows and columns must come from different dimensions");
    }
    await this.ensureSchema();
    const { sql, params } = buildCubeSql(organizationId, q);
    const raw = await this.prisma.$queryRawUnsafe<
      { row_member: string | null; col_member: string | null; value: unknown; row_total: number; col_total: number }[]
    >(sql, ...params);

    const rows: string[] = [];
    const cols: string[] = [];
    const cells: Record<string, Record<string, number>> = {};
    const rowTotals: Record<string, number> = {};
    const colTotals: Record<string, number> = {};
    let grandTotal = 0;

    for (const r of raw) {
      const value = Number(r.value ?? 0);
      const isRowTotal = Number(r.row_total) === 1;
      const isColTotal = Number(r.col_total) === 1;
      if (isRowTotal && isColTotal) grandTotal = value;
      else if (isColTotal) {
        rows.push(r.row_member!);
        rowTotals[r.row_member!] = value;
      } else if (isRowTotal) {
        cols.push(r.col_member!);
        colTotals[r.col_member!] = value;
      } else {
        (cells[r.row_member!] ??= {})[r.col_member!] = value;
      }
    }

    if (cols.length > MAX_COLUMNS) {
      throw invalidOperation(
        `${cols.length} columns is too many to display. Roll the column dimension up a level or slice it first.`,
      );
    }

    return { rows, cols, cells, rowTotals, colTotals, grandTotal };
  }

  private schemaReady = false;

  private async ensureSchema() {
    if (this.schemaReady) return;
    for (const stmt of STAR_SCHEMA_DDL) await this.prisma.$executeRawUnsafe(stmt);
    this.schemaReady = true;
  }
}
