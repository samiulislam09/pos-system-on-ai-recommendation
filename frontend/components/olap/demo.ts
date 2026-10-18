import type { CubeResult, CubeState, Level } from "@/lib/olap";

export type OpKind = "Roll-up" | "Drill-down" | "Slice" | "Dice" | "Pivot" | "View";

export interface DemoContext {
  state: CubeState;
  result: CubeResult;
  members: (level: Level) => Promise<string[]>;
}

export interface DemoStep {
  kind: OpKind;
  title: string;
  /** What the operation is, in general terms, and what to point out on screen. */
  explain: string;
  build: (ctx: DemoContext) => Promise<CubeState> | CubeState;
}

const topRow = (r: CubeResult) => [...r.rows].sort((a, b) => (r.rowTotals[b] ?? 0) - (r.rowTotals[a] ?? 0))[0];
const topCols = (r: CubeResult, k: number) => [...r.cols].sort((a, b) => (r.colTotals[b] ?? 0) - (r.colTotals[a] ?? 0)).slice(0, k);

export const DEMO_START: CubeState = { measure: "revenue", rows: "year", cols: "category", filters: [] };

/**
 * The guided walkthrough. Each step derives its target from the previous
 * result (e.g. "the best quarter"), so it works on whatever data is loaded.
 */
export const DEMO_STEPS: DemoStep[] = [
  {
    kind: "View",
    title: "The cube, fully rolled up",
    explain:
      "Revenue by Year × Category. Each cell is SUM(revenue) over every day, product and store beneath it: the coarsest level of the Time hierarchy. Note the grand total; the operations below either preserve it or explain why it changes.",
    build: () => DEMO_START,
  },
  {
    kind: "Drill-down",
    title: "Drill down: Year → Quarter",
    explain:
      "Drill-down moves to a finer level of a hierarchy. The year splits into its quarters, and the quarters add up to exactly the year's total: no data was removed, it is only shown in more detail.",
    build: ({ state, result }) => ({
      ...state,
      rows: "quarter",
      filters: [...state.filters, { level: "year", values: [topRow(result)] }],
    }),
  },
  {
    kind: "Drill-down",
    title: "Drill down again: best Quarter → Month",
    explain:
      "Drilling into the highest-revenue quarter shows its months. The total is now that quarter's total, because we followed one branch of the hierarchy down.",
    build: ({ state, result }) => ({
      ...state,
      rows: "month",
      filters: [...state.filters.filter((f) => f.level !== "quarter"), { level: "quarter", values: [topRow(result)] }],
    }),
  },
  {
    kind: "Roll-up",
    title: "Roll up: Month → Quarter",
    explain:
      "Roll-up is the reverse: months are aggregated back into quarters (SUM over the finer level). The grand total returns to the full-year figure from the first drill-down.",
    build: ({ state }) => ({ ...state, rows: "quarter", filters: state.filters.filter((f) => f.level !== "quarter") }),
  },
  {
    kind: "Slice",
    title: "Slice: one store only",
    explain:
      "Slice fixes ONE dimension to a single value. Here Location = one store, so we look at a 2-D slice (Time × Product) of the 3-D cube. The total drops to that store's share.",
    build: async ({ state, members }) => {
      const stores = await members("store");
      return { ...state, filters: [...state.filters.filter((f) => f.level !== "store"), { level: "store", values: [stores[0]] }] };
    },
  },
  {
    kind: "Dice",
    title: "Dice: store × top two categories",
    explain:
      "Dice selects a sub-cube using conditions on TWO OR MORE dimensions: the same store AND only the two best-selling categories. Unlike a slice, the result is still a cube, just a smaller one.",
    build: ({ state, result }) => ({
      ...state,
      filters: [...state.filters.filter((f) => f.level !== "category"), { level: "category", values: topCols(result, 2) }],
    }),
  },
  {
    kind: "Pivot",
    title: "Pivot: swap rows and columns",
    explain:
      "Pivot (rotate) turns the cube to view it from another angle: categories become rows and quarters become columns. The numbers and the grand total are identical; only the orientation changed.",
    build: ({ state }) => ({ ...state, rows: state.cols ?? state.rows, cols: state.rows }),
  },
];
