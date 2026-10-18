"use client";

import { Button, Card, CardContent, CardHeader, CardTitle, formatDate } from "@/components/ui";
import type { OlapStatus } from "@/lib/olap";

const n = (v: number) => v.toLocaleString("en-US");

function Stage({ step, title, subtitle, children }: { step: number; title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col rounded-lg border border-zinc-200 bg-zinc-50/60 p-4">
      <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-teal-700">Step {step}</p>
      <p className="mt-0.5 text-sm font-semibold text-zinc-950">{title}</p>
      <p className="text-xs text-zinc-500">{subtitle}</p>
      <div className="mt-3 flex-1 space-y-1 text-xs text-zinc-700">{children}</div>
    </div>
  );
}

function Count({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="truncate font-mono text-[11px] text-zinc-500">{label}</span>
      <span className="font-semibold tabular-nums text-zinc-900">{n(value)}</span>
    </div>
  );
}

function Arrow() {
  return (
    <div className="flex items-center justify-center text-zinc-300 lg:px-1" aria-hidden>
      <span className="rotate-90 text-xl lg:rotate-0">→</span>
    </div>
  );
}

/** Source → ETL → star schema → cube, with live row counts. */
export function ArchitecturePanel({ status, onRunEtl, running }: { status: OlapStatus; onRunEtl: () => void; running: boolean }) {
  const { source, warehouse } = status;
  const possibleCells = warehouse.dimDate * warehouse.dimProduct * warehouse.dimLocation;
  const density = possibleCells > 0 ? (warehouse.factSales / possibleCells) * 100 : 0;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle>How it works: from sales to an OLAP cube</CardTitle>
        <p className="mt-1 text-xs text-zinc-500">
          The POS writes normalized rows for every sale (OLTP). An ETL job reshapes them into a star schema built for analysis
          (OLAP), and the cube is queried from there.
        </p>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-2 lg:flex-row">
          <Stage step={1} title="POS database (OLTP)" subtitle="Normalized tables, one row per event">
            <Count label="Sale" value={source.sales} />
            <Count label="SaleItem" value={source.saleItems} />
            <Count label="Product" value={source.products} />
            <Count label="Location" value={source.locations} />
          </Stage>
          <Arrow />
          <Stage step={2} title="ETL" subtitle={status.refreshedAt ? `Last run ${formatDate(status.refreshedAt)}` : "Not run yet"}>
            <p>
              <b>Extract</b> completed sales and their line items
            </p>
            <p>
              <b>Transform</b> to one row per day × product × store; derive quarter, look up category, compute cost
            </p>
            <p>
              <b>Load</b> into the <span className="font-mono">olap</span> schema
            </p>
            <Button variant="outline" className="mt-2 min-h-8 w-full py-1 text-xs" onClick={onRunEtl} disabled={running}>
              {running ? "Running ETL…" : "Run ETL now"}
            </Button>
          </Stage>
          <Arrow />
          <Stage step={3} title="Star schema" subtitle="1 fact table + 3 dimension tables">
            <Count label="fact_sales" value={warehouse.factSales} />
            <Count label="dim_date" value={warehouse.dimDate} />
            <Count label="dim_product" value={warehouse.dimProduct} />
            <Count label="dim_location" value={warehouse.dimLocation} />
          </Stage>
          <Arrow />
          <Stage step={4} title="OLAP cube" subtitle="3 dimensions × 3 measures">
            <p>Time × Product × Location</p>
            <p>Units sold, Revenue, Profit</p>
            <p className="pt-1 text-zinc-500">
              {n(warehouse.dimDate)} days × {n(warehouse.dimProduct)} products × {n(warehouse.dimLocation)} locations ={" "}
              <b className="text-zinc-800">{n(possibleCells)}</b> possible cells, {density.toFixed(1)}% filled (a sparse cube)
            </p>
          </Stage>
        </div>
      </CardContent>
    </Card>
  );
}
