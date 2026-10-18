"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  Empty,
  Loading,
  PageHeader,
  Select,
  cn,
} from "@/components/ui";
import {
  DIMENSIONS,
  LEVEL_LABELS,
  MEASURES,
  childLevel,
  dimensionOf,
  formatMeasure,
  formatMeasureCompact,
  levelDepth,
  parentLevel,
  summarize,
  type CubeFilter,
  type CubeResult,
  type CubeState,
  type Dimension,
  type Level,
  type Measure,
  type OlapStatus,
  type ViewSummary,
} from "@/lib/olap";
import { ArchitecturePanel } from "@/components/olap/architecture";
import { CubeChart } from "@/components/olap/cube-chart";
import { DEMO_START, DEMO_STEPS, type OpKind } from "@/components/olap/demo";

interface Step {
  state: CubeState;
  kind: OpKind;
  text: string;
  /** Shape and total of the view this step replaced. */
  before: ViewSummary | null;
}

const OPERATIONS: Array<{ kind: OpKind; how: string; what: string }> = [
  { kind: "Roll-up", what: "Aggregate to a coarser level of a hierarchy (Month → Quarter → Year).", how: "Click ↑, or a breadcrumb." },
  { kind: "Drill-down", what: "Break a value into a finer level (Year → Quarter → Month → Day).", how: "Click a row label, or ↓." },
  { kind: "Slice", what: "Fix one dimension to a single value, cutting one slice out of the cube.", how: "Filter one level to one value." },
  { kind: "Dice", what: "Pick a sub-cube by selecting values on two or more dimensions.", how: "Filter several values or dimensions." },
  { kind: "Pivot", what: "Rotate the cube: swap the row and column dimensions.", how: "Click Pivot." },
];

const KIND_COLOR: Record<OpKind, "blue" | "indigo" | "amber" | "red" | "green" | "zinc"> = {
  "Roll-up": "blue",
  "Drill-down": "indigo",
  Slice: "amber",
  Dice: "red",
  Pivot: "green",
  View: "zinc",
};

const ALL_LEVELS = (Object.keys(DIMENSIONS) as Dimension[]).flatMap((d) => DIMENSIONS[d].levels as readonly Level[]);

function filterKind(filters: CubeFilter[]): OpKind {
  return filters.length === 1 && filters[0].values.length === 1 ? "Slice" : "Dice";
}

function describeFilters(filters: CubeFilter[]) {
  return filters.map((f) => `${LEVEL_LABELS[f.level]} = ${f.values.join(", ")}`).join(" and ");
}

function BeforeAfter({ before, after, measure }: { before: ViewSummary | null; after: ViewSummary | null; measure: Measure }) {
  if (!before || !after) return null;
  const shape = (s: ViewSummary) => `${s.rows} × ${Math.max(s.cols, 1)}`;
  const same = Math.abs(before.total - after.total) < 0.005;
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 rounded-md bg-zinc-100 px-2.5 py-1 text-xs text-zinc-600">
      <span>
        Before <b className="tabular-nums text-zinc-800">{shape(before)}</b> · {formatMeasureCompact(measure, before.total)}
      </span>
      <span aria-hidden>→</span>
      <span>
        Now <b className="tabular-nums text-zinc-800">{shape(after)}</b> · {formatMeasureCompact(measure, after.total)}
      </span>
      <span className={same ? "font-medium text-emerald-700" : "font-medium text-amber-700"}>{same ? "total preserved" : "total changed"}</span>
    </span>
  );
}

export default function AnalyticsPage() {
  const queryClient = useQueryClient();
  const [history, setHistory] = useState<Step[]>([{ state: DEMO_START, kind: "View", text: "Start: revenue by year and category", before: null }]);
  const current = history[history.length - 1];
  const state = current.state;

  const [pickLevel, setPickLevel] = useState<Level | "">("");
  const [picked, setPicked] = useState<string[]>([]);
  const [demo, setDemo] = useState<{ index: number } | null>(null);
  const [demoBusy, setDemoBusy] = useState(false);
  const [showArchitecture, setShowArchitecture] = useState(true);

  const status = useQuery({
    queryKey: ["olap-status"],
    queryFn: () => apiFetch<OlapStatus>("/olap/status"),
  });
  const loaded = (status.data?.factRows ?? 0) > 0;

  const result = useQuery({
    queryKey: ["olap-query", state],
    queryFn: () => apiFetch<CubeResult>("/olap/query", { method: "POST", body: state }),
    enabled: loaded,
    placeholderData: (prev) => prev,
  });

  const fetchMembers = (level: Level) =>
    queryClient.fetchQuery({
      queryKey: ["olap-members", level],
      queryFn: () => apiFetch<string[]>(`/olap/members?level=${level}`),
      staleTime: 60_000,
    });

  const members = useQuery({
    queryKey: ["olap-members", pickLevel],
    queryFn: () => apiFetch<string[]>(`/olap/members?level=${pickLevel}`),
    enabled: loaded && pickLevel !== "",
  });

  const colMembers = useQuery({
    queryKey: ["olap-members", state.cols],
    queryFn: () => apiFetch<string[]>(`/olap/members?level=${state.cols}`),
    enabled: loaded && state.cols !== null,
  });

  const etl = useMutation({
    mutationFn: () => apiFetch<OlapStatus>("/olap/refresh", { method: "POST" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["olap-status"] });
      queryClient.invalidateQueries({ queryKey: ["olap-query"] });
      queryClient.invalidateQueries({ queryKey: ["olap-members"] });
    },
  });

  const data = result.data;
  const settled = !!data && !result.isFetching && !result.isPlaceholderData;

  const apply = (next: CubeState, kind: OpKind, text: string) =>
    setHistory((h) => [...h, { state: next, kind, text, before: summarize(data) }]);

  // A level change inside one hierarchy is a roll-up or drill-down; across hierarchies it is just a new view.
  const levelChangeKind = (from: Level | null, to: Level | null): OpKind =>
    from && to && dimensionOf(from) === dimensionOf(to) ? (levelDepth(to) < levelDepth(from) ? "Roll-up" : "Drill-down") : "View";

  const setRows = (rows: Level) =>
    apply({ ...state, rows }, levelChangeKind(state.rows, rows), `Rows: ${LEVEL_LABELS[state.rows]} → ${LEVEL_LABELS[rows]}`);

  const setCols = (cols: Level | null) =>
    apply(
      { ...state, cols },
      levelChangeKind(state.cols, cols),
      `Columns: ${state.cols ? LEVEL_LABELS[state.cols] : "none"} → ${cols ? LEVEL_LABELS[cols] : "none"}`,
    );

  /** Roll the rows up to `target` (an ancestor level), dropping the drill filters between. */
  const rollUpRowsTo = (target: Level) => {
    const dim = dimensionOf(state.rows);
    const filters = state.filters.filter(
      (f) => dimensionOf(f.level) !== dim || levelDepth(f.level) < levelDepth(target) || levelDepth(f.level) >= levelDepth(state.rows),
    );
    apply({ ...state, rows: target, filters }, "Roll-up", `${LEVEL_LABELS[state.rows]} → ${LEVEL_LABELS[target]}`);
  };

  const drillInto = (member: string) => {
    const child = childLevel(state.rows);
    if (!child) return;
    const filters = [...state.filters.filter((f) => f.level !== state.rows), { level: state.rows, values: [member] }];
    apply({ ...state, rows: child, filters }, "Drill-down", `${LEVEL_LABELS[state.rows]} "${member}" → by ${LEVEL_LABELS[child]}`);
  };

  const pivot = () => {
    if (!state.cols) return;
    apply({ ...state, rows: state.cols, cols: state.rows }, "Pivot", `Rows ${LEVEL_LABELS[state.rows]} ⇄ Columns ${LEVEL_LABELS[state.cols]}`);
  };

  const addFilter = () => {
    if (!pickLevel || picked.length === 0) return;
    const filters = [...state.filters.filter((f) => f.level !== pickLevel), { level: pickLevel, values: picked }];
    apply({ ...state, filters }, filterKind(filters), describeFilters(filters));
    setPickLevel("");
    setPicked([]);
  };

  const removeFilter = (level: Level) => {
    const filters = state.filters.filter((f) => f.level !== level);
    apply(
      { ...state, filters },
      filters.length === 0 ? "View" : filterKind(filters),
      filters.length === 0 ? `Removed filter on ${LEVEL_LABELS[level]}` : describeFilters(filters),
    );
  };

  // --- Guided demo -------------------------------------------------------
  const runDemoStep = async (index: number) => {
    const step = DEMO_STEPS[index];
    setDemoBusy(true);
    try {
      const next = await step.build({ state, result: data!, members: fetchMembers });
      setHistory((h) => [...h, { state: next, kind: step.kind, text: step.title, before: summarize(data) }]);
      setDemo({ index });
    } finally {
      setDemoBusy(false);
    }
  };

  const startDemo = () => {
    setDemo({ index: 0 });
    setHistory([{ state: DEMO_START, kind: "View", text: DEMO_STEPS[0].title, before: null }]);
    setShowArchitecture(false);
  };

  const demoBack = () => {
    if (!demo || demo.index === 0) return;
    setHistory((h) => h.slice(0, -1));
    setDemo({ ...demo, index: demo.index - 1 });
  };

  // --- Breadcrumb for the row dimension's drill path ---------------------
  const rowDim = dimensionOf(state.rows);
  const rowLevels = DIMENSIONS[rowDim].levels as readonly Level[];
  const ancestors = rowLevels.slice(0, levelDepth(state.rows));
  const crumbs = ancestors
    .map((level) => ({ level, filter: state.filters.find((f) => f.level === level && f.values.length === 1) }))
    .filter((c) => c.filter);

  const canDrillRows = childLevel(state.rows) !== null;
  const values = data ? (state.cols ? Object.values(data.cells).flatMap((r) => Object.values(r)) : Object.values(data.rowTotals)) : [];
  const max = Math.max(1, ...values.map(Math.abs));
  const demoStep = demo ? DEMO_STEPS[demo.index] : null;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Analytics · Data warehouse"
        title="OLAP cube explorer"
        description="Multidimensional analysis of POS sales: a star-schema warehouse loaded by ETL, queried as a cube with roll-up, drill-down, slice, dice and pivot."
        actions={
          <>
            <Button variant="outline" onClick={() => setShowArchitecture((v) => !v)}>
              {showArchitecture ? "Hide architecture" : "Show architecture"}
            </Button>
            {loaded && (
              <Button onClick={startDemo} disabled={demoBusy}>
                ▶ Start guided demo
              </Button>
            )}
          </>
        }
      />

      {etl.isError && <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{(etl.error as Error).message}</p>}

      {status.isLoading || !status.data ? (
        <Loading />
      ) : (
        <>
          {showArchitecture && <ArchitecturePanel status={status.data} onRunEtl={() => etl.mutate()} running={etl.isPending} />}

          {!loaded ? (
            <Card>
              <CardContent className="pt-6">
                <Empty label="The warehouse is empty" hint="Run the ETL to load completed sales into the star schema." />
              </CardContent>
            </Card>
          ) : (
            <>
              {demo && demoStep && (
                <Card className="border-teal-600 shadow-[0_0_0_4px_rgba(15,118,110,0.10)]">
                  <CardContent className="space-y-3 pt-5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-teal-700">
                          Guided demo · step {demo.index + 1} of {DEMO_STEPS.length}
                        </span>
                        <Badge color={KIND_COLOR[demoStep.kind]}>{demoStep.kind}</Badge>
                      </div>
                      <div className="flex gap-1">
                        {DEMO_STEPS.map((s, i) => (
                          <span key={i} className={cn("h-1.5 w-6 rounded-full", i <= demo.index ? "bg-teal-600" : "bg-zinc-200")} />
                        ))}
                      </div>
                    </div>
                    <h2 className="text-lg font-semibold tracking-[-0.02em] text-zinc-950">{demoStep.title}</h2>
                    <p className="max-w-3xl text-sm leading-6 text-zinc-600">{demoStep.explain}</p>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <BeforeAfter before={current.before} after={settled ? summarize(data) : null} measure={state.measure} />
                      <div className="ml-auto flex gap-2">
                        <Button variant="ghost" onClick={() => setDemo(null)}>
                          Exit demo
                        </Button>
                        <Button variant="outline" onClick={demoBack} disabled={demo.index === 0 || demoBusy}>
                          Back
                        </Button>
                        {demo.index < DEMO_STEPS.length - 1 ? (
                          <Button onClick={() => runDemoStep(demo.index + 1)} disabled={!settled || demoBusy}>
                            Next: {DEMO_STEPS[demo.index + 1].kind} →
                          </Button>
                        ) : (
                          <Button onClick={() => setDemo(null)}>Finish</Button>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}

              <Card>
                <CardContent className="grid gap-2 pt-5 sm:grid-cols-5">
                  {OPERATIONS.map((op) => (
                    <div
                      key={op.kind}
                      className={cn("rounded-lg border p-3 transition-colors", current.kind === op.kind ? "border-teal-600 bg-teal-50" : "border-zinc-200")}
                    >
                      <Badge color={KIND_COLOR[op.kind]}>{op.kind}</Badge>
                      <p className="mt-2 text-xs leading-5 text-zinc-600">{op.what}</p>
                      <p className="mt-1 text-[11px] font-medium text-zinc-400">{op.how}</p>
                    </div>
                  ))}
                </CardContent>
              </Card>

              <Card>
                <CardContent className="space-y-4 pt-5">
                  <div className="flex flex-wrap items-end gap-4">
                    <label className="grid gap-1 text-xs font-medium text-zinc-500">
                      Measure
                      <Select
                        value={state.measure}
                        onChange={(e) => apply({ ...state, measure: e.target.value as Measure }, "View", `Measure: ${MEASURES[e.target.value as Measure]}`)}
                      >
                        {(Object.keys(MEASURES) as Measure[]).map((m) => (
                          <option key={m} value={m}>
                            {MEASURES[m]}
                          </option>
                        ))}
                      </Select>
                    </label>

                    <label className="grid gap-1 text-xs font-medium text-zinc-500">
                      Rows
                      <span className="flex gap-1">
                        <Select value={state.rows} onChange={(e) => setRows(e.target.value as Level)}>
                          {(Object.keys(DIMENSIONS) as Dimension[]).map((d) => (
                            <optgroup key={d} label={DIMENSIONS[d].label}>
                              {DIMENSIONS[d].levels.map((l) => (
                                <option key={l} value={l} disabled={state.cols !== null && dimensionOf(state.cols) === d}>
                                  {LEVEL_LABELS[l]}
                                </option>
                              ))}
                            </optgroup>
                          ))}
                        </Select>
                        <Button
                          variant="outline"
                          className="px-3"
                          title="Roll up rows"
                          aria-label="Roll up rows"
                          disabled={!parentLevel(state.rows)}
                          onClick={() => rollUpRowsTo(parentLevel(state.rows)!)}
                        >
                          ↑
                        </Button>
                        <Button variant="outline" className="px-3" title="Drill down rows" aria-label="Drill down rows" disabled={!canDrillRows} onClick={() => setRows(childLevel(state.rows)!)}>
                          ↓
                        </Button>
                      </span>
                    </label>

                    <label className="grid gap-1 text-xs font-medium text-zinc-500">
                      Columns
                      <span className="flex gap-1">
                        <Select value={state.cols ?? ""} onChange={(e) => setCols((e.target.value || null) as Level | null)}>
                          <option value="">None</option>
                          {(Object.keys(DIMENSIONS) as Dimension[])
                            .filter((d) => d !== rowDim)
                            .map((d) => (
                              <optgroup key={d} label={DIMENSIONS[d].label}>
                                {DIMENSIONS[d].levels.map((l) => (
                                  <option key={l} value={l}>
                                    {LEVEL_LABELS[l]}
                                  </option>
                                ))}
                              </optgroup>
                            ))}
                        </Select>
                        <Button
                          variant="outline"
                          className="px-3"
                          title="Roll up columns"
                          aria-label="Roll up columns"
                          disabled={!state.cols || !parentLevel(state.cols)}
                          onClick={() => setCols(parentLevel(state.cols!))}
                        >
                          ↑
                        </Button>
                        <Button
                          variant="outline"
                          className="px-3"
                          title="Drill down columns"
                          aria-label="Drill down columns"
                          disabled={!state.cols || !childLevel(state.cols)}
                          onClick={() => setCols(childLevel(state.cols!))}
                        >
                          ↓
                        </Button>
                      </span>
                    </label>

                    <Button variant="outline" onClick={pivot} disabled={!state.cols}>
                      ⇄ Pivot
                    </Button>
                    <div className="ml-auto flex gap-2">
                      <Button variant="ghost" onClick={() => setHistory((h) => h.slice(0, -1))} disabled={history.length < 2 || demo !== null}>
                        Undo
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={() => {
                          setDemo(null);
                          apply(DEMO_START, "View", "Reset to start view");
                        }}
                      >
                        Reset
                      </Button>
                    </div>
                  </div>

                  <div className="border-t border-zinc-100 pt-4">
                    <p className="mb-2 text-xs font-medium text-zinc-500">Slice &amp; dice filters</p>
                    <div className="flex flex-wrap items-start gap-3">
                      {state.filters.length === 0 && <span className="py-1 text-sm text-zinc-400">None: the whole cube is in view.</span>}
                      {state.filters.map((f) => (
                        <span key={f.level} className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 py-1 pl-3 pr-1 text-xs text-amber-800">
                          {LEVEL_LABELS[f.level]}: {f.values.join(", ")}
                          <button onClick={() => removeFilter(f.level)} className="rounded-full px-1.5 text-amber-600 hover:bg-amber-100" aria-label={`Remove ${LEVEL_LABELS[f.level]} filter`}>
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                    <div className="mt-3 flex flex-wrap items-start gap-3">
                      <Select
                        value={pickLevel}
                        onChange={(e) => {
                          setPickLevel(e.target.value as Level | "");
                          setPicked([]);
                        }}
                      >
                        <option value="">Add a filter…</option>
                        {ALL_LEVELS.map((l) => (
                          <option key={l} value={l}>
                            {DIMENSIONS[dimensionOf(l)].label} › {LEVEL_LABELS[l]}
                          </option>
                        ))}
                      </Select>
                      {pickLevel && (
                        <>
                          <div className="flex max-h-32 max-w-2xl flex-wrap gap-1.5 overflow-y-auto">
                            {members.isLoading && <span className="text-sm text-zinc-400">Loading…</span>}
                            {members.data?.map((m) => {
                              const on = picked.includes(m);
                              return (
                                <button
                                  key={m}
                                  onClick={() => setPicked((p) => (on ? p.filter((x) => x !== m) : [...p, m]))}
                                  className={cn(
                                    "rounded-full border px-2.5 py-1 text-xs",
                                    on ? "border-teal-600 bg-teal-600 text-white" : "border-zinc-300 bg-white text-zinc-700 hover:border-zinc-400",
                                  )}
                                >
                                  {m}
                                </button>
                              );
                            })}
                          </div>
                          <Button onClick={addFilter} disabled={picked.length === 0}>
                            Apply ({picked.length === 1 ? "slice" : "dice"})
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="space-y-3 pb-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Badge color={KIND_COLOR[current.kind]}>{current.kind}</Badge>
                      <span className="text-sm text-zinc-700">{current.text}</span>
                    </div>
                    {!demo && <BeforeAfter before={current.before} after={settled ? summarize(data) : null} measure={state.measure} />}
                  </div>
                  <nav aria-label="Drill path" className="flex flex-wrap items-center gap-1 text-sm">
                    <span className="mr-1 text-xs font-medium text-zinc-400">{DIMENSIONS[rowDim].label}:</span>
                    {levelDepth(state.rows) > 0 ? (
                      <button onClick={() => rollUpRowsTo(rowLevels[0])} className="rounded px-1.5 py-0.5 text-teal-700 hover:bg-teal-50">
                        All
                      </button>
                    ) : (
                      <span className="px-1.5 text-zinc-500">All</span>
                    )}
                    {crumbs.map((c) => (
                      <span key={c.level} className="flex items-center gap-1">
                        <span className="text-zinc-300">›</span>
                        <button
                          onClick={() => rollUpRowsTo(childLevel(c.level)!)}
                          disabled={childLevel(c.level) === state.rows}
                          className="rounded px-1.5 py-0.5 text-teal-700 hover:bg-teal-50 disabled:text-zinc-800 disabled:hover:bg-transparent"
                        >
                          {c.filter!.values[0]}
                        </button>
                      </span>
                    ))}
                    <span className="text-zinc-300">›</span>
                    <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs font-medium text-zinc-600">by {LEVEL_LABELS[state.rows]}</span>
                    {canDrillRows && <span className="ml-2 text-xs text-zinc-400">Click a row to drill down</span>}
                  </nav>
                </CardHeader>
                <CardContent className="space-y-6">
                  {result.isError ? (
                    <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{(result.error as Error).message}</p>
                  ) : !data ? (
                    <Loading />
                  ) : data.rows.length === 0 ? (
                    <Empty label="No sales match these filters" />
                  ) : (
                    <>
                      <div className={cn("transition-opacity", result.isFetching && "opacity-60")}>
                        <CubeChart result={data} state={state} colMembers={colMembers.data} />
                      </div>
                      <div className={cn("w-full overflow-x-auto rounded-lg border border-zinc-200", result.isFetching && "opacity-60")}>
                        <table className="w-full text-sm">
                          <thead className="border-b border-zinc-200 bg-zinc-50/80">
                            <tr>
                              <th className="whitespace-nowrap px-3 py-3 text-left text-[10px] font-bold uppercase tracking-[0.1em] text-zinc-500">
                                {LEVEL_LABELS[state.rows]}
                                {state.cols && <span className="text-zinc-400"> \ {LEVEL_LABELS[state.cols]}</span>}
                              </th>
                              {state.cols &&
                                data.cols.map((c) => (
                                  <th key={c} className="whitespace-nowrap px-3 py-3 text-right text-[10px] font-bold uppercase tracking-[0.1em] text-zinc-500">
                                    {c}
                                  </th>
                                ))}
                              <th className="whitespace-nowrap px-3 py-3 text-right text-[10px] font-bold uppercase tracking-[0.1em] text-zinc-700">Total</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-zinc-100 bg-white">
                            {data.rows.map((r) => (
                              <tr key={r} className="hover:bg-zinc-50/60">
                                <td className="whitespace-nowrap px-3 py-2">
                                  {canDrillRows ? (
                                    <button onClick={() => drillInto(r)} className="font-medium text-teal-700 hover:underline" title={`Drill down into ${r}`}>
                                      {r} <span className="text-xs text-teal-500">↓</span>
                                    </button>
                                  ) : (
                                    <span className="font-medium text-zinc-800">{r}</span>
                                  )}
                                </td>
                                {state.cols &&
                                  data.cols.map((c) => {
                                    const v = data.cells[r]?.[c];
                                    return (
                                      <td
                                        key={c}
                                        className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-zinc-800"
                                        style={v ? { backgroundColor: `rgba(15,118,110,${(0.04 + (Math.abs(v) / max) * 0.24).toFixed(3)})` } : undefined}
                                      >
                                        {v === undefined ? "—" : formatMeasure(state.measure, v)}
                                      </td>
                                    );
                                  })}
                                <td className="whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums text-zinc-950">{formatMeasure(state.measure, data.rowTotals[r])}</td>
                              </tr>
                            ))}
                          </tbody>
                          <tfoot className="border-t-2 border-zinc-200 bg-zinc-50/80 font-semibold">
                            <tr>
                              <td className="px-3 py-2.5 text-zinc-700">Total</td>
                              {state.cols &&
                                data.cols.map((c) => (
                                  <td key={c} className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-zinc-800">
                                    {formatMeasure(state.measure, data.colTotals[c])}
                                  </td>
                                ))}
                              <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-zinc-950">{formatMeasure(state.measure, data.grandTotal)}</td>
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>
            </>
          )}
        </>
      )}
    </div>
  );
}
