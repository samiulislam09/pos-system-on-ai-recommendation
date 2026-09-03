"use client";

import { useState } from "react";
import { Button, cn } from "@/components/ui";
import { Dialog } from "@/components/management/dialog";
import { downloadSalesCsv } from "@/lib/export";

function localTodayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function toISO(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(y, m - 1, d + days);
  return toISO(date.getFullYear(), date.getMonth() + 1, date.getDate());
}

function fmtDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function rangeDays(start: string, end: string): number {
  const [sy, sm, sd] = start.split("-").map(Number);
  const [ey, em, ed] = end.split("-").map(Number);
  return Math.round((new Date(ey, em - 1, ed).getTime() - new Date(sy, sm - 1, sd).getTime()) / 86_400_000) + 1;
}

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

interface Selection {
  start: string;
  end: string;
  /** True when `start` was clicked by the user and awaits a second click to form a range. */
  anchored: boolean;
}

function Calendar({
  year,
  month,
  selection,
  today,
  onNavigate,
  onPick,
}: {
  year: number;
  month: number; // 1-12
  selection: Selection;
  today: string;
  onNavigate: (year: number, month: number) => void;
  onPick: (iso: string) => void;
}) {
  const firstWeekday = new Date(year, month - 1, 1).getDay();
  const daysInMonth = new Date(year, month, 0).getDate();
  const cells: (string | null)[] = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => toISO(year, month, i + 1)),
  ];
  const prev = () => (month === 1 ? onNavigate(year - 1, 12) : onNavigate(year, month - 1));
  const next = () => (month === 12 ? onNavigate(year + 1, 1) : onNavigate(year, month + 1));

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <Button type="button" variant="ghost" className="px-2.5" aria-label="Previous month" onClick={prev}>←</Button>
        <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{MONTHS[month - 1]} {year}</p>
        <Button type="button" variant="ghost" className="px-2.5" aria-label="Next month" onClick={next}>→</Button>
      </div>
      <div className="grid grid-cols-7 text-center text-xs font-medium text-zinc-400">
        {WEEKDAYS.map((w) => <div key={w} className="py-1">{w}</div>)}
      </div>
      <div className="grid grid-cols-7">
        {cells.map((iso, i) => {
          if (!iso) return <div key={`blank-${i}`} />;
          const inRange = iso >= selection.start && iso <= selection.end;
          const isEdge = iso === selection.start || iso === selection.end;
          const isFuture = iso > today;
          return (
            <button
              key={iso}
              type="button"
              disabled={isFuture}
              aria-label={fmtDate(iso)}
              aria-pressed={inRange}
              onClick={() => onPick(iso)}
              className={cn(
                "min-h-10 text-sm tabular-nums transition-colors",
                isEdge
                  ? "rounded-lg bg-teal-600 font-semibold text-white"
                  : inRange
                    ? "bg-teal-50 text-teal-900 dark:bg-teal-950/40 dark:text-teal-200"
                    : "rounded-lg text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800",
                iso === today && !inRange ? "font-semibold text-teal-700 underline underline-offset-4" : "",
                isFuture ? "cursor-not-allowed text-zinc-300 hover:bg-transparent dark:text-zinc-700" : "",
              )}
            >
              {Number(iso.slice(8))}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function SalesCsvButton({
  storeId,
  storeCode,
  label = "Sales CSV",
  className,
}: {
  storeId: string;
  storeCode: string;
  label?: string;
  className?: string;
}) {
  const [today] = useState(localTodayISO);
  const [open, setOpen] = useState(false);
  const [selection, setSelection] = useState<Selection>({ start: today, end: today, anchored: false });
  const [view, setView] = useState(() => ({ year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const pick = (iso: string) => {
    setSelection((sel) => {
      // First click (or click after a range/preset) selects a single day.
      if (!sel.anchored || sel.start !== sel.end) return { start: iso, end: iso, anchored: true };
      if (iso === sel.start) return sel;
      // Second click on an anchored day extends it into a range.
      return iso < sel.start
        ? { start: iso, end: sel.start, anchored: false }
        : { start: sel.start, end: iso, anchored: false };
    });
  };

  const preset = (start: string, end: string) => {
    setSelection({ start, end, anchored: false });
    setView({ year: Number(end.slice(0, 4)), month: Number(end.slice(5, 7)) });
  };

  const download = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await downloadSalesCsv({ storeId, storeCode, from: selection.start, to: selection.end });
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The export could not be downloaded.");
    } finally {
      setBusy(false);
    }
  };

  const single = selection.start === selection.end;
  const summary = single
    ? fmtDate(selection.start)
    : `${fmtDate(selection.start)} – ${fmtDate(selection.end)} (${rangeDays(selection.start, selection.end)} days)`;

  return (
    <>
      <Button type="button" variant="outline" className={className} onClick={() => setOpen(true)}>
        {label}
      </Button>
      <Dialog
        open={open}
        title="Download sales CSV"
        description="Pick a date, or pick two dates for a range."
        size="sm"
        onClose={() => setOpen(false)}
      >
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="ghost" className="px-2.5 text-xs" onClick={() => preset(today, today)}>Today</Button>
            <Button type="button" variant="ghost" className="px-2.5 text-xs" onClick={() => preset(addDays(today, -6), today)}>Last 7 days</Button>
            <Button type="button" variant="ghost" className="px-2.5 text-xs" onClick={() => preset(addDays(today, -29), today)}>Last 30 days</Button>
            <Button type="button" variant="ghost" className="px-2.5 text-xs" onClick={() => preset(`${today.slice(0, 7)}-01`, today)}>This month</Button>
          </div>
          <Calendar
            year={view.year}
            month={view.month}
            selection={selection}
            today={today}
            onNavigate={(year, month) => setView({ year, month })}
            onPick={pick}
          />
          {error ? <p role="alert" className="text-xs text-red-600">{error}</p> : null}
          <Button type="button" className="min-h-11 w-full" disabled={busy} onClick={() => void download()}>
            {busy ? "Preparing…" : `Download ${summary}`}
          </Button>
        </div>
      </Dialog>
    </>
  );
}
