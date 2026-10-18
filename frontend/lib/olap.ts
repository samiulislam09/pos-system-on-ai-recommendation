// Mirrors backend/apps/api/src/olap/olap.cube.ts — keep the level keys,
// hierarchies and measures identical.
export const DIMENSIONS = {
  time: { label: "Time", levels: ["year", "quarter", "month", "day"] },
  product: { label: "Product", levels: ["category", "product"] },
  location: { label: "Location", levels: ["locationType", "store"] },
} as const;

export type Dimension = keyof typeof DIMENSIONS;
export type Level = (typeof DIMENSIONS)[Dimension]["levels"][number];

export const LEVEL_LABELS: Record<Level, string> = {
  year: "Year",
  quarter: "Quarter",
  month: "Month",
  day: "Day",
  category: "Category",
  product: "Product",
  locationType: "Location type",
  store: "Store",
};

export const MEASURES = {
  quantity: "Units sold",
  revenue: "Revenue",
  profit: "Profit",
} as const;

export type Measure = keyof typeof MEASURES;

export interface CubeFilter {
  level: Level;
  values: string[];
}

export interface CubeState {
  measure: Measure;
  rows: Level;
  cols: Level | null;
  filters: CubeFilter[];
}

export interface CubeResult {
  rows: string[];
  cols: string[];
  cells: Record<string, Record<string, number>>;
  rowTotals: Record<string, number>;
  colTotals: Record<string, number>;
  grandTotal: number;
}

export function dimensionOf(level: Level): Dimension {
  return (Object.keys(DIMENSIONS) as Dimension[]).find((d) =>
    (DIMENSIONS[d].levels as readonly Level[]).includes(level),
  )!;
}

function levelsOf(level: Level): readonly Level[] {
  return DIMENSIONS[dimensionOf(level)].levels;
}

/** One level finer in the same hierarchy (Quarter → Month), or null at the leaf. */
export function childLevel(level: Level): Level | null {
  const levels = levelsOf(level);
  return levels[levels.indexOf(level) + 1] ?? null;
}

/** One level coarser in the same hierarchy (Month → Quarter), or null at the top. */
export function parentLevel(level: Level): Level | null {
  const levels = levelsOf(level);
  return levels[levels.indexOf(level) - 1] ?? null;
}

export function levelDepth(level: Level): number {
  return levelsOf(level).indexOf(level);
}

export interface OlapStatus {
  refreshedAt: string | null;
  factRows: number;
  source: { sales: number; saleItems: number; products: number; locations: number };
  warehouse: { factSales: number; dimDate: number; dimProduct: number; dimLocation: number };
}

/** Grand total and shape of a result, for before/after comparisons. */
export interface ViewSummary {
  rows: number;
  cols: number;
  total: number;
}

export function summarize(result: CubeResult | undefined): ViewSummary | null {
  return result ? { rows: result.rows.length, cols: result.cols.length, total: result.grandTotal } : null;
}

export function formatMeasure(measure: Measure, n: number) {
  return measure === "quantity" ? n.toLocaleString("en-US") : `৳${Math.round(n).toLocaleString("en-US")}`;
}

export function formatMeasureCompact(measure: Measure, n: number) {
  const s = n.toLocaleString("en-US", { notation: "compact", maximumFractionDigits: 1 });
  return measure === "quantity" ? s : `৳${s}`;
}
