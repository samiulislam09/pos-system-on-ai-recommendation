"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { SupplierApiError, supplierApiFetch } from "@/lib/supplier-api";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Empty, Loading, PageHeader } from "@/components/ui";
import {
  ETL_COLUMNS,
  NUMBER_KEYS,
  findEmptyColumns,
  toEditableRow,
  type EditableRow,
  type EtlKey,
} from "@/lib/supplier-etl";

interface IncompleteItem extends Record<EtlKey, string | number | null> {
  id: string;
  missingFields: string[] | null;
  upload: { id: string; originalName: string; vendorNote: string | null; status: string; createdAt: string };
}

type RowErrors = Record<string, string[]>;

export default function SupplierIncompletePage() {
  const queryClient = useQueryClient();
  const { data: items, isLoading } = useQuery({
    queryKey: ["supplier-incomplete-items"],
    queryFn: () => supplierApiFetch<IncompleteItem[]>("/supplier-portal/incomplete-items"),
  });

  const [edits, setEdits] = useState<Record<string, EditableRow>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [rowErrors, setRowErrors] = useState<RowErrors>({});
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);

  const groups = useMemo(() => {
    const byUpload = new Map<string, { upload: IncompleteItem["upload"]; rows: IncompleteItem[] }>();
    for (const item of items ?? []) {
      const g = byUpload.get(item.upload.id) ?? { upload: item.upload, rows: [] };
      g.rows.push(item);
      byUpload.set(item.upload.id, g);
    }
    return [...byUpload.values()];
  }, [items]);

  const rowOf = (item: IncompleteItem) => edits[item.id] ?? toEditableRow(item);

  const resubmit = useMutation({
    mutationFn: (payload: Array<Record<string, string | number>>) =>
      supplierApiFetch<{ resubmitted: number; uploads: number }>("/supplier-portal/incomplete-items/resubmit", {
        method: "POST",
        body: { items: payload },
      }),
    onSuccess: (data, payload) => {
      const sent = new Set(payload.map((p) => String(p.id)));
      setEdits((prev) => Object.fromEntries(Object.entries(prev).filter(([id]) => !sent.has(id))));
      setSelected(new Set());
      setRowErrors({});
      setMessage({ tone: "success", text: `${data.resubmitted} row(s) sent back to the vendor for review.` });
      queryClient.invalidateQueries({ queryKey: ["supplier-incomplete-items"] });
      queryClient.invalidateQueries({ queryKey: ["supplier-profile"] });
      queryClient.invalidateQueries({ queryKey: ["supplier-uploads"] });
    },
    onError: (err) => {
      const details = err instanceof SupplierApiError ? (err.details as { rows?: Array<{ id: string; fields: string[] }> } | undefined) : undefined;
      if (details?.rows) setRowErrors(Object.fromEntries(details.rows.map((r) => [r.id, r.fields])));
      setMessage({ tone: "error", text: err instanceof Error ? err.message : "Resubmission failed" });
    },
  });

  if (isLoading) return <Loading />;

  const all = items ?? [];
  const setCell = (item: IncompleteItem, key: EtlKey, value: string) => {
    setEdits((prev) => ({ ...prev, [item.id]: { ...rowOf(item), [key]: value } }));
    setRowErrors((prev) => {
      if (!prev[item.id]) return prev;
      const { [item.id]: _drop, ...rest } = prev;
      return rest;
    });
  };
  const toggle = (ids: string[], on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => (on ? next.add(id) : next.delete(id)));
      return next;
    });

  const handleResubmit = () => {
    const chosen = all.filter((i) => selected.has(i.id));
    const failures = Object.fromEntries(
      chosen.map((i) => [i.id, findEmptyColumns(rowOf(i))]).filter(([, f]) => f.length > 0),
    ) as RowErrors;
    if (Object.keys(failures).length > 0) {
      setRowErrors(failures);
      setMessage({ tone: "error", text: `${Object.keys(failures).length} selected row(s) still have empty values.` });
      return;
    }
    setMessage(null);
    resubmit.mutate(
      chosen.map((i) => {
        const row = rowOf(i);
        return Object.fromEntries([
          ["id", i.id],
          ...ETL_COLUMNS.map(({ key }) => [
            key,
            NUMBER_KEYS.includes(key)
              ? key === "orderQty"
                ? Math.trunc(Number(row[key]))
                : Number(row[key])
              : row[key].trim(),
          ]),
        ]);
      }),
    );
  };

  const isFlagged = (item: IncompleteItem, row: EditableRow, column: string, key: EtlKey) =>
    findEmptyColumns(row).includes(column) ||
    (rowErrors[item.id] ?? []).includes(column) ||
    (column === "sku" &&
      (item.missingFields ?? []).includes("duplicate_sku") &&
      row[key] === String(item[key] ?? ""));

  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow="Needs your correction"
        title="Incomplete data"
        description="Rows the vendor sent back, or flagged in a rejected file, because of empty values or duplicate SKUs. Edit any cell, select the rows, and resubmit them."
        actions={
          all.length > 0 ? (
            <Button onClick={handleResubmit} disabled={selected.size === 0 || resubmit.isPending}>
              {resubmit.isPending ? "Resubmitting..." : `Resubmit ${selected.size} row(s)`}
            </Button>
          ) : null
        }
      />

      {message && (
        <p
          className={`rounded-lg border p-3 text-sm ${
            message.tone === "error" ? "border-red-200 bg-red-50 text-red-700" : "border-emerald-200 bg-emerald-50 text-emerald-800"
          }`}
        >
          {message.text}
        </p>
      )}

      {all.length === 0 ? (
        <Card>
          <CardContent className="pt-6">
            <Empty label="No incomplete data — you're all caught up." />
          </CardContent>
        </Card>
      ) : (
        groups.map(({ upload, rows }) => {
          const ids = rows.map((r) => r.id);
          const allOn = ids.every((id) => selected.has(id));
          return (
            <Card key={upload.id}>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2">
                  {upload.originalName}
                  {upload.status === "REJECTED" && <Badge color="red">File rejected</Badge>}
                </CardTitle>
                {upload.vendorNote && (
                  <p className="mt-1 rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
                    Vendor note: {upload.vendorNote}
                  </p>
                )}
                {upload.status === "REJECTED" && (
                  <p className="mt-1 text-xs text-zinc-500">
                    Resubmitting these rows sends the whole file back to the vendor for review.
                  </p>
                )}
              </CardHeader>
              <CardContent>
                <div className="w-full overflow-x-auto rounded-lg border border-zinc-200">
                  <table className="w-full text-sm">
                    <thead className="border-b border-zinc-200 bg-zinc-50/80">
                      <tr>
                        <th className="px-3 py-3">
                          <input
                            type="checkbox"
                            aria-label={`Select all rows in ${upload.originalName}`}
                            className="h-4 w-4 accent-teal-600"
                            checked={allOn}
                            onChange={() => toggle(ids, !allOn)}
                          />
                        </th>
                        {ETL_COLUMNS.map((c) => (
                          <th key={c.column} className="whitespace-nowrap px-2 py-3 text-left text-[10px] font-bold uppercase tracking-[0.1em] text-zinc-500">
                            {c.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100 bg-white">
                      {rows.map((item) => {
                        const row = rowOf(item);
                        return (
                          <tr key={item.id} className={rowErrors[item.id] ? "bg-red-50/40" : ""}>
                            <td className="px-3 py-2">
                              <input
                                type="checkbox"
                                aria-label={`Select row ${row.sku || item.id}`}
                                className="h-4 w-4 accent-teal-600"
                                checked={selected.has(item.id)}
                                onChange={() => toggle([item.id], !selected.has(item.id))}
                              />
                            </td>
                            {ETL_COLUMNS.map((c) => (
                              <td key={c.column} className="px-1 py-1">
                                <input
                                  type={c.kind === "number" ? "number" : "text"}
                                  min={c.kind === "number" ? 0 : undefined}
                                  step={c.key === "orderQty" ? 1 : c.kind === "number" ? 0.01 : undefined}
                                  aria-label={`${c.label} for ${row.sku || item.id}`}
                                  value={row[c.key]}
                                  onChange={(e) => setCell(item, c.key, e.target.value)}
                                  className={`min-h-9 w-full min-w-[7rem] rounded-md border bg-white px-2 py-1 text-sm text-zinc-900 outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-600/15 ${
                                    isFlagged(item, row, c.column, c.key) ? "border-red-400 bg-red-50" : "border-zinc-300"
                                  }`}
                                />
                              </td>
                            ))}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          );
        })
      )}
    </div>
  );
}
