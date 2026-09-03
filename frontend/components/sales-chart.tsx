"use client";

export interface SalesPoint {
  day: string;
  total: number | string;
  transactions: number;
}

// Round up to 1/2/5 × 10^n so the axis labels are round numbers.
function niceCeil(value: number): number {
  if (value <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 5, 10]) {
    if (value <= step * pow) return step * pow;
  }
  return 10 * pow;
}

function compactMoney(n: number): string {
  return `৳${n.toLocaleString("en-US", { notation: "compact", maximumFractionDigits: 1 })}`;
}

function shortDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function fullDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

export function SalesBarChart({ data, height = 160 }: { data: SalesPoint[]; height?: number }) {
  const totals = data.map((d) => (typeof d.total === "string" ? parseFloat(d.total) : d.total));
  const max = niceCeil(Math.max(...totals, 1));
  const first = data[0];
  const mid = data[Math.floor(data.length / 2)];
  const last = data[data.length - 1];

  return (
    <div
      role="img"
      aria-label={`Daily sales from ${shortDate(first.day)} to ${shortDate(last.day)}, peaking at ${compactMoney(Math.max(...totals))}`}
    >
      <div className="flex gap-2">
        <div
          className="flex w-10 shrink-0 flex-col justify-between text-right text-[10px] tabular-nums text-zinc-400"
          style={{ height }}
          aria-hidden
        >
          <span>{compactMoney(max)}</span>
          <span>{compactMoney(max / 2)}</span>
          <span>0</span>
        </div>
        <div className="relative flex-1" style={{ height }}>
          <div className="pointer-events-none absolute inset-0 flex flex-col justify-between" aria-hidden>
            <div className="border-t border-dashed border-zinc-200" />
            <div className="border-t border-dashed border-zinc-200" />
            <div className="border-t border-zinc-300" />
          </div>
          <div className="absolute inset-0 flex items-end gap-1">
            {data.map((d, i) => {
              const total = totals[i];
              return (
                <div key={d.day} className="group relative flex h-full flex-1 items-end">
                  <div
                    className="w-full rounded-t-sm bg-teal-600 transition-colors group-hover:bg-teal-700"
                    style={{ height: `${Math.max((total / max) * 100, 1.5)}%` }}
                  />
                  <div
                    className={`pointer-events-none absolute bottom-full z-10 mb-1.5 hidden whitespace-nowrap rounded-md bg-zinc-900 px-2.5 py-1.5 text-[11px] leading-tight text-white shadow-lg group-hover:block ${
                      i < data.length / 4 ? "left-0" : i > (data.length * 3) / 4 ? "right-0" : "left-1/2 -translate-x-1/2"
                    }`}
                  >
                    <div className="font-medium">{fullDate(d.day)}</div>
                    <div className="text-zinc-300">
                      {compactMoney(total)} · {d.transactions} txn{d.transactions === 1 ? "" : "s"}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <div className="mt-1.5 flex justify-between pl-12 text-[10px] text-zinc-400" aria-hidden>
        <span>{shortDate(first.day)}</span>
        {data.length > 2 ? <span>{shortDate(mid.day)}</span> : null}
        <span>{shortDate(last.day)}</span>
      </div>
    </div>
  );
}
