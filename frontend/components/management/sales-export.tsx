"use client";

import { useState } from "react";
import { Button, Input } from "@/components/ui";
import { downloadSalesCsv, todayISO } from "@/lib/export";

export function SalesExport({ storeId, storeCode }: { storeId: string; storeCode: string }) {
  const [from, setFrom] = useState(todayISO);
  const [to, setTo] = useState(todayISO);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const valid = Boolean(from && to && from <= to);

  const download = async () => {
    if (!valid || busy) return;
    setBusy(true);
    setError("");
    try {
      await downloadSalesCsv({ storeId, storeCode, from, to });
    } catch (err) {
      setError(err instanceof Error ? err.message : "The export could not be downloaded.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-wrap items-end gap-2">
      <div>
        <label htmlFor="export-from" className="mb-1 block text-xs font-medium text-zinc-500">From</label>
        <Input id="export-from" type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} className="w-auto" />
      </div>
      <div>
        <label htmlFor="export-to" className="mb-1 block text-xs font-medium text-zinc-500">To</label>
        <Input id="export-to" type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} className="w-auto" />
      </div>
      <Button variant="outline" disabled={!valid || busy} onClick={() => void download()}>
        {busy ? "Preparing…" : "Download CSV"}
      </Button>
      {!valid ? <p className="w-full text-xs text-red-600">The start date must not be after the end date.</p> : null}
      {error ? <p role="alert" className="w-full text-xs text-red-600">{error}</p> : null}
    </div>
  );
}

/** One-click export of today's sales — used on the store cards in the Locations list. */
export function TodaySalesCsvButton({ storeId, storeCode }: { storeId: string; storeCode: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const download = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const day = todayISO();
      await downloadSalesCsv({ storeId, storeCode, from: day, to: day });
    } catch (err) {
      setError(err instanceof Error ? err.message : "The export could not be downloaded.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-4">
      <Button variant="outline" className="w-full" disabled={busy} onClick={() => void download()}>
        {busy ? "Preparing…" : "Today's sales CSV"}
      </Button>
      {error ? <p role="alert" className="mt-1 text-xs text-red-600">{error}</p> : null}
    </div>
  );
}
