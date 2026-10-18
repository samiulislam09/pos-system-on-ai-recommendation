"use client";

import { dimensionOf, formatMeasure, formatMeasureCompact, type CubeResult, type CubeState } from "@/lib/olap";

// Validated categorical order (light surface); colors follow the member, not its rank.
const SERIES = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"];
const OTHER = "#9ca3af";
const SINGLE = "#0f766e";

function niceCeil(value: number): number {
  if (value <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 5, 10]) if (value <= step * pow) return step * pow;
  return 10 * pow;
}

interface Series {
  name: string;
  color: string;
  members: string[];
}

/**
 * Colors are keyed to the member's position in the level's full member list, so
 * slicing or dicing a column away never repaints the ones that remain. Past
 * eight members the tail folds into "Other".
 */
function buildSeries(result: CubeResult, allMembers: string[] | undefined): Series[] {
  if (result.cols.length === 0) return [{ name: "Total", color: SINGLE, members: [] }];
  const universe = allMembers && allMembers.length > 0 ? allMembers : result.cols;
  const fold = universe.length > SERIES.length;
  const named: Series[] = [];
  const other: Series = { name: "Other", color: OTHER, members: [] };
  for (const col of result.cols) {
    const idx = universe.indexOf(col);
    if (idx >= 0 && (!fold || idx < SERIES.length - 1)) named.push({ name: col, color: SERIES[idx], members: [col] });
    else other.members.push(col);
  }
  return other.members.length > 0 ? [...named, other] : named;
}

export function CubeChart({ result, state, colMembers }: { result: CubeResult; state: CubeState; colMembers?: string[] }) {
  const series = buildSeries(result, colMembers);
  const stacked = result.cols.length > 0;
  const valueOf = (row: string, s: Series) =>
    stacked ? s.members.reduce((sum, m) => sum + Math.max(0, result.cells[row]?.[m] ?? 0), 0) : Math.max(0, result.rowTotals[row] ?? 0);
  const max = niceCeil(Math.max(1, ...result.rows.map((r) => Math.max(0, result.rowTotals[r] ?? 0))));
  const vertical = dimensionOf(state.rows) === "time";
  const fmt = (v: number) => formatMeasure(state.measure, v);

  const tooltip = (row: string) => (
    <div className="pointer-events-none hidden min-w-40 whitespace-nowrap rounded-md bg-zinc-900 px-2.5 py-2 text-[11px] leading-5 text-white shadow-lg group-hover:block">
      <div className="font-semibold">{row}</div>
      {stacked &&
        series.map((s) => (
          <div key={s.name} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 text-zinc-300">
              <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: s.color }} />
              {s.name}
            </span>
            <span className="tabular-nums">{fmt(valueOf(row, s))}</span>
          </div>
        ))}
      <div className="mt-0.5 flex justify-between gap-4 border-t border-zinc-700 pt-0.5 font-semibold">
        <span>Total</span>
        <span className="tabular-nums">{fmt(result.rowTotals[row] ?? 0)}</span>
      </div>
    </div>
  );

  const segments = (row: string, dir: "row" | "col") => {
    const total = Math.max(0, result.rowTotals[row] ?? 0);
    const parts = series.map((s) => ({ s, v: valueOf(row, s) })).filter((p) => p.v > 0);
    return (
      <div
        className={dir === "col" ? "flex w-full flex-col-reverse gap-[2px]" : "flex h-full flex-row gap-[2px]"}
        style={dir === "col" ? { height: `${(total / max) * 100}%` } : { width: `${(total / max) * 100}%` }}
      >
        {parts.map(({ s, v }, i) => (
          <div
            key={s.name}
            className={
              i === parts.length - 1 ? (dir === "col" ? "rounded-t" : "rounded-r") : ""
            }
            style={{ backgroundColor: s.color, flexGrow: v, flexBasis: 0, minHeight: dir === "col" ? 1 : undefined, minWidth: dir === "row" ? 1 : undefined }}
          />
        ))}
      </div>
    );
  };

  const legend = stacked && (
    <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1">
      {series.map((s) => (
        <span key={s.name} className="flex items-center gap-1.5 text-xs text-zinc-600">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: s.color }} />
          {s.name}
          {s.name === "Other" && <span className="text-zinc-400">({s.members.length})</span>}
        </span>
      ))}
    </div>
  );

  if (vertical) {
    const height = 220;
    const labelEvery = Math.ceil(result.rows.length / 12);
    return (
      <div role="img" aria-label={`${state.measure} by ${state.rows}${stacked ? ` and ${state.cols}` : ""}`}>
        {legend}
        <div className="flex gap-2">
          <div className="flex w-12 shrink-0 flex-col justify-between text-right text-[10px] tabular-nums text-zinc-400" style={{ height }} aria-hidden>
            <span>{formatMeasureCompact(state.measure, max)}</span>
            <span>{formatMeasureCompact(state.measure, max / 2)}</span>
            <span>0</span>
          </div>
          <div className="relative flex-1" style={{ height }}>
            <div className="pointer-events-none absolute inset-0 flex flex-col justify-between" aria-hidden>
              <div className="border-t border-dashed border-zinc-200" />
              <div className="border-t border-dashed border-zinc-200" />
              <div className="border-t border-zinc-300" />
            </div>
            <div className="absolute inset-0 flex items-end gap-1">
              {result.rows.map((row, i) => (
                <div key={row} className="group relative flex h-full min-w-0 flex-1 items-end justify-center hover:bg-zinc-100/70">
                  <div className="flex h-full w-full max-w-14 items-end">{segments(row, "col")}</div>
                  <div className={`absolute bottom-full z-20 mb-1.5 ${i < result.rows.length / 2 ? "left-0" : "right-0"}`}>{tooltip(row)}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="mt-1.5 flex gap-1 pl-14 text-[10px] text-zinc-500" aria-hidden>
          {result.rows.map((row, i) => (
            <span key={row} className="min-w-0 flex-1 truncate text-center">
              {i % labelEvery === 0 ? row : ""}
            </span>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div role="img" aria-label={`${state.measure} by ${state.rows}${stacked ? ` and ${state.cols}` : ""}`}>
      {legend}
      <div className="max-h-[420px] space-y-1.5 overflow-y-auto pr-1">
        {result.rows.map((row) => (
          <div key={row} className="group relative flex items-center gap-3 rounded hover:bg-zinc-50">
            <span className="w-36 shrink-0 truncate text-right text-xs text-zinc-600" title={row}>
              {row}
            </span>
            <div className="h-5 flex-1">{segments(row, "row")}</div>
            <span className="w-24 shrink-0 text-right text-xs tabular-nums text-zinc-800">{formatMeasureCompact(state.measure, result.rowTotals[row] ?? 0)}</span>
            <div className="absolute left-40 top-full z-20 mt-1">{tooltip(row)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
