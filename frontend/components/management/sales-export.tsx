"use client";

import { useState } from "react";
import { API_URL, getToken, refreshSession } from "@/lib/api";
import { Button, Input } from "@/components/ui";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function SalesExport({ storeId, storeCode }: { storeId: string; storeCode: string }) {
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const valid = Boolean(from && to && from <= to);

  const download = async () => {
    if (!valid || busy) return;
    setBusy(true);
    setError("");
    try {
      const params = new URLSearchParams({
        storeId,
        from: new Date(`${from}T00:00:00.000Z`).toISOString(),
        to: new Date(`${to}T23:59:59.999Z`).toISOString(),
      });
      const request = (token: string | null) =>
        fetch(`${API_URL}/sales/export?${params}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
      let res = await request(getToken());
      if (res.status === 401) {
        const fresh = await refreshSession();
        if (fresh) res = await request(fresh);
      }
      if (!res.ok) throw new Error(`Export failed (HTTP ${res.status})`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `sales-${storeCode}-${from}${from === to ? "" : `_${to}`}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
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
