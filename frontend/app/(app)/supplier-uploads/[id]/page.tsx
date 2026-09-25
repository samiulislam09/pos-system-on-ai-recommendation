"use client";

import Link from "next/link";
import { use, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Empty,
  Loading,
  PageHeader,
  Select,
  Textarea,
  formatMoney,
} from "@/components/ui";

type EtlStatus = "NEW" | "GOOD" | "INCOMPLETE" | "RETURNED" | "STOCKED";
type BadgeColor = "zinc" | "green" | "red" | "amber" | "blue" | "indigo";

interface UploadItem {
  id: string;
  poNumber: string;
  vendorId: string;
  vendorName: string;
  sku: string;
  itemDescription: string;
  category: string;
  orderQty: number;
  unitPriceBdt: number | string;
  totalAmountBdt: number | string;
  orderDate: string | null;
  deliveryDate: string | null;
  status: string | null;
  missingFields: string[] | null;
  etlStatus: EtlStatus;
  stockedAt: string | null;
  stockedLocation: { id: string; name: string } | null;
}

interface UploadDetail {
  id: string;
  originalName: string;
  status: string;
  rowCount: number;
  submissionCount: number;
  vendorNote: string | null;
  createdAt: string;
  supplierUser: { id: string; name: string; email: string; phone: string | null };
  items: UploadItem[];
}

interface Store {
  id: string;
  name: string;
  code: string;
  type: string;
}

interface StockResult {
  createdProducts: number;
  existingProducts: number;
  stockedCount: number;
  location: { id: string; name: string };
}

const TABS: EtlStatus[] = ["NEW", "GOOD", "INCOMPLETE", "RETURNED", "STOCKED"];
const TAB_LABELS: Record<EtlStatus, string> = {
  NEW: "New",
  GOOD: "Good",
  INCOMPLETE: "Incomplete",
  RETURNED: "Returned to supplier",
  STOCKED: "Stocked",
};
const TAB_COLORS: Record<EtlStatus, BadgeColor> = {
  NEW: "zinc",
  GOOD: "green",
  INCOMPLETE: "amber",
  RETURNED: "blue",
  STOCKED: "indigo",
};

// Catalog fields the vendor can choose not to write when stocking.
const OPTIONAL_FIELDS = ["itemDescription", "category", "unitPriceBdt"] as const;
type AcceptField = (typeof OPTIONAL_FIELDS)[number];

interface Column {
  column: string;
  label: string;
  align?: "right";
  field?: AcceptField;
  /** Needed to stock a row, so it is always checked. */
  required?: true;
  render: (item: UploadItem) => React.ReactNode;
}

const text = (v: string | null) => (v && v.trim() ? v : null);

const COLUMNS: Column[] = [
  { column: "po_number", label: "PO #", render: (i) => text(i.poNumber) },
  { column: "vendor_id", label: "Vendor ID", render: (i) => text(i.vendorId) },
  { column: "vendor_name", label: "Vendor", render: (i) => text(i.vendorName) },
  { column: "sku", label: "SKU", required: true, render: (i) => text(i.sku) && <span className="font-mono text-xs">{i.sku}</span> },
  { column: "item_description", label: "Description", field: "itemDescription", render: (i) => text(i.itemDescription) },
  { column: "category", label: "Category", field: "category", render: (i) => text(i.category) },
  { column: "order_qty", label: "Qty", align: "right", required: true, render: (i) => (i.orderQty > 0 ? i.orderQty.toLocaleString() : null) },
  { column: "unit_price_bdt", label: "Unit price", align: "right", field: "unitPriceBdt", render: (i) => (Number(i.unitPriceBdt) > 0 ? formatMoney(i.unitPriceBdt) : null) },
  { column: "total_amount_bdt", label: "Total", align: "right", render: (i) => (Number(i.totalAmountBdt) > 0 ? formatMoney(i.totalAmountBdt) : null) },
  { column: "order_date", label: "Order date", render: (i) => text(i.orderDate) },
  { column: "delivery_date", label: "Delivery", render: (i) => text(i.deliveryDate) },
  { column: "status", label: "Status", render: (i) => text(i.status) },
];

const TH = "whitespace-nowrap px-3 py-3 text-left text-[10px] font-bold uppercase tracking-[0.1em] text-zinc-500";

function isFlagged(item: UploadItem, column: string) {
  const missing = item.missingFields ?? [];
  return missing.includes(column) || (column === "sku" && missing.includes("duplicate_sku"));
}

export default function VendorUploadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const queryClient = useQueryClient();
  const { id } = use(params);

  const { data: upload, isLoading } = useQuery({
    queryKey: ["manage-supplier-upload", id],
    queryFn: () => apiFetch<UploadDetail>(`/supplier-portal/manage/uploads/${id}`),
    enabled: !!id,
  });
  const { data: stores } = useQuery({
    queryKey: ["stores"],
    queryFn: () => apiFetch<Store[]>("/stores"),
  });

  const [tab, setTab] = useState<EtlStatus | null>(null);
  const [locationId, setLocationId] = useState("");
  const [deselectedIds, setDeselectedIds] = useState<Set<string>>(new Set());
  const [excludedColumns, setExcludedColumns] = useState<Set<string>>(new Set());
  const [returnNote, setReturnNote] = useState("");
  const [rejectNote, setRejectNote] = useState("");
  const [etlResult, setEtlResult] = useState<{ good: number; incomplete: number } | null>(null);
  const [stockResult, setStockResult] = useState<StockResult | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["manage-supplier-upload", id] });
    queryClient.invalidateQueries({ queryKey: ["manage-supplier-uploads"] });
    setDeselectedIds(new Set());
    setActionError(null);
  };
  const onError = (err: unknown) => setActionError(err instanceof Error ? err.message : "Action failed");

  const etlMutation = useMutation({
    mutationFn: (body: { itemIds: string[]; columns: string[] }) =>
      apiFetch<{ good: number; incomplete: number }>(`/supplier-portal/manage/uploads/${id}/etl`, {
        method: "POST",
        body,
      }),
    onSuccess: (data) => {
      setEtlResult(data);
      setTab(data.good > 0 ? "GOOD" : "INCOMPLETE");
      refresh();
    },
    onError,
  });

  const stockMutation = useMutation({
    mutationFn: (body: { locationId: string; itemIds: string[]; fields?: AcceptField[] }) =>
      apiFetch<StockResult>(`/supplier-portal/manage/uploads/${id}/accept`, { method: "POST", body }),
    onSuccess: (data) => {
      setStockResult(data);
      refresh();
    },
    onError,
  });

  const returnMutation = useMutation({
    mutationFn: (note: string) =>
      apiFetch<{ returned: number }>(`/supplier-portal/manage/uploads/${id}/return-incomplete`, {
        method: "POST",
        body: note.trim() ? { note: note.trim() } : {},
      }),
    onSuccess: () => {
      setReturnNote("");
      refresh();
    },
    onError,
  });

  const rejectMutation = useMutation({
    mutationFn: (note: string) =>
      apiFetch(`/supplier-portal/manage/uploads/${id}/reject`, { method: "POST", body: { note } }),
    onSuccess: () => {
      setRejectNote("");
      refresh();
    },
    onError,
  });

  const counts = useMemo(() => {
    const c: Record<EtlStatus, number> = { NEW: 0, GOOD: 0, INCOMPLETE: 0, RETURNED: 0, STOCKED: 0 };
    for (const item of upload?.items ?? []) c[item.etlStatus]++;
    return c;
  }, [upload]);

  if (isLoading || !id) return <Loading />;
  if (!upload) return <Empty label="Upload not found" />;

  const activeTab: EtlStatus = tab ?? TABS.find((t) => counts[t] > 0) ?? "NEW";
  const rows = upload.items.filter((i) => i.etlStatus === activeTab);
  const isPending = upload.status === "PENDING";
  const selectable = isPending && (activeTab === "NEW" || activeTab === "GOOD");
  const selectedRows = rows.filter((i) => !deselectedIds.has(i.id));
  const allSelected = selectable && selectedRows.length === rows.length;
  const isExcluded = (c: Column) => !c.required && excludedColumns.has(c.column);
  const statusColor: BadgeColor =
    upload.status === "ACCEPTED" ? "green" : upload.status === "REJECTED" ? "red" : upload.status === "INCOMPLETE" ? "amber" : "indigo";

  const toggle = <T,>(set: Set<T>, value: T) => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    return next;
  };

  const handleEtl = () => {
    etlMutation.mutate({
      itemIds: selectedRows.map((i) => i.id),
      columns: COLUMNS.filter((c) => !isExcluded(c)).map((c) => c.column),
    });
  };

  const handleStock = () => {
    const fields = COLUMNS.filter((c) => c.field && !isExcluded(c)).map((c) => c.field!);
    stockMutation.mutate({
      locationId,
      itemIds: selectedRows.map((i) => i.id),
      ...(fields.length < OPTIONAL_FIELDS.length ? { fields } : {}),
    });
  };

  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow="Supplier upload review"
        title={upload.originalName}
        description={`From ${upload.supplierUser.name} · Submitted ${new Date(upload.createdAt).toLocaleString()} · ${upload.items.length} rows · Attempt #${upload.submissionCount}`}
        actions={
          <div className="flex gap-2">
            <Badge color={statusColor}>{upload.status}</Badge>
            <Link
              href="/supplier-uploads"
              className="inline-flex min-h-10 items-center justify-center rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-semibold text-zinc-700 shadow-sm hover:border-zinc-400 hover:bg-zinc-50"
            >
              Back to queue
            </Link>
          </div>
        }
      />

      {actionError && (
        <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{actionError}</p>
      )}

      {etlResult && (
        <p className="rounded-lg border border-teal-200 bg-teal-50 p-3 text-sm text-teal-800">
          ETL complete: <span className="font-semibold">{etlResult.good} good</span> ·{" "}
          <span className="font-semibold">{etlResult.incomplete} incomplete</span>
        </p>
      )}

      {stockResult && (
        <Card className="border-emerald-200 bg-emerald-50/50">
          <CardContent className="pt-6">
            <p className="text-sm text-emerald-800">
              Added <span className="font-semibold">{stockResult.stockedCount}</span> row(s) to{" "}
              <span className="font-semibold">{stockResult.location.name}</span> ·{" "}
              {stockResult.createdProducts} new product(s), {stockResult.existingProducts} updated.
            </p>
            <p className="mt-2 text-xs text-emerald-700">
              AI forecasting has been triggered to retrain with the new stock.{" "}
              <Link href="/ai-insights" className="font-semibold underline">View AI Insights</Link>
            </p>
          </CardContent>
        </Card>
      )}

      {/* Items */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap gap-2">
            {TABS.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => { setTab(t); setDeselectedIds(new Set()); }}
                className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-medium ${
                  activeTab === t ? "border-teal-600 bg-teal-50 text-teal-800" : "border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50"
                }`}
              >
                {TAB_LABELS[t]}
                <Badge color={TAB_COLORS[t]}>{counts[t]}</Badge>
              </button>
            ))}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {selectable && activeTab === "NEW" && rows.length > 0 && (
            <div className="grid gap-3 rounded-lg border border-teal-200 bg-teal-50/40 p-4 sm:grid-cols-[1fr_auto] sm:items-center">
              <p className="text-xs text-zinc-600">
                Choose the rows and columns to check, then run ETL. Selected rows with an empty
                value in a checked column, or a duplicate SKU, become incomplete; the rest are
                good. SKU and Qty are always checked because stocking needs them. Unselected rows
                stay here for a later run.
              </p>
              <Button onClick={handleEtl} disabled={selectedRows.length === 0 || etlMutation.isPending}>
                {etlMutation.isPending ? "Running ETL..." : `Run ETL on ${selectedRows.length} row(s)`}
              </Button>
            </div>
          )}

          {selectable && activeTab === "GOOD" && rows.length > 0 && (
            <div className="grid gap-3 rounded-lg border border-emerald-200 bg-emerald-50/40 p-4 sm:grid-cols-[1fr_auto] sm:items-end">
              <label className="grid gap-2 text-sm font-semibold text-zinc-700">
                Add selected good rows to store or warehouse
                <Select value={locationId} onChange={(e) => setLocationId(e.target.value)}>
                  <option value="">Choose a location...</option>
                  {stores?.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.type === "WAREHOUSE" ? "Warehouse" : "Store"})
                    </option>
                  ))}
                </Select>
              </label>
              <Button
                disabled={!locationId || selectedRows.length === 0 || stockMutation.isPending}
                onClick={handleStock}
              >
                {stockMutation.isPending ? "Adding to stock..." : `Add ${selectedRows.length} row(s) to stock`}
              </Button>
              {COLUMNS.some((c) => c.field && isExcluded(c)) && (
                <p className="text-xs text-amber-700 sm:col-span-2">
                  Unchecked description, category or unit price are not written; existing products
                  keep their current values.
                </p>
              )}
            </div>
          )}

          {isPending && activeTab === "INCOMPLETE" && rows.length > 0 && (
            <div className="grid gap-3 rounded-lg border border-amber-200 bg-amber-50/40 p-4">
              <label className="grid gap-2 text-sm font-semibold text-zinc-700">
                Note to supplier (optional)
                <Textarea
                  rows={3}
                  value={returnNote}
                  onChange={(e) => setReturnNote(e.target.value)}
                  placeholder="e.g. Please fill in the vendor ID and delivery date for these rows."
                />
              </label>
              <Button onClick={() => returnMutation.mutate(returnNote)} disabled={returnMutation.isPending}>
                {returnMutation.isPending ? "Sending..." : `Send ${rows.length} incomplete row(s) to supplier`}
              </Button>
            </div>
          )}

          {rows.length > 0 ? (
            <div className="w-full overflow-x-auto rounded-lg border border-zinc-200">
              <table className="w-full text-sm">
                <thead className="border-b border-zinc-200 bg-zinc-50/80">
                  <tr>
                    {selectable && (
                      <th className="px-3 py-3">
                        <input
                          type="checkbox"
                          aria-label="Select all rows"
                          className="h-4 w-4 accent-teal-600"
                          checked={allSelected}
                          ref={(el) => {
                            if (el) el.indeterminate = selectedRows.length > 0 && !allSelected;
                          }}
                          onChange={() =>
                            setDeselectedIds(allSelected ? new Set(rows.map((i) => i.id)) : new Set())
                          }
                        />
                      </th>
                    )}
                    {COLUMNS.map((c) => (
                      <th key={c.column} className={`${TH} ${c.align === "right" ? "text-right" : ""}`}>
                        <span className="inline-flex items-center gap-1.5">
                          {selectable && (
                            <input
                              type="checkbox"
                              aria-label={`Use ${c.label} column`}
                              title={c.required ? "Always used — needed to stock the row" : undefined}
                              className="h-3.5 w-3.5 accent-teal-600 disabled:opacity-60"
                              checked={!isExcluded(c)}
                              disabled={c.required}
                              onChange={() => setExcludedColumns((s) => toggle(s, c.column))}
                            />
                          )}
                          {c.label}
                        </span>
                      </th>
                    ))}
                    {activeTab === "STOCKED" && (
                      <>
                        <th className={TH}>Store</th>
                        <th className={TH}>Stocked at</th>
                      </>
                    )}
                    {(activeTab === "INCOMPLETE" || activeTab === "RETURNED") && <th className={TH}>Problems</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 bg-white">
                  {rows.map((item) => {
                    const off = selectable && deselectedIds.has(item.id);
                    return (
                      <tr key={item.id} className={`hover:bg-teal-50/30 ${off ? "opacity-40" : ""}`}>
                        {selectable && (
                          <td className="px-3 py-2">
                            <input
                              type="checkbox"
                              aria-label={`Select row ${item.sku}`}
                              className="h-4 w-4 accent-teal-600"
                              checked={!deselectedIds.has(item.id)}
                              onChange={() => setDeselectedIds((s) => toggle(s, item.id))}
                            />
                          </td>
                        )}
                        {COLUMNS.map((c) => {
                          const value = c.render(item);
                          const flagged = isFlagged(item, c.column);
                          const dimmed = selectable && isExcluded(c);
                          return (
                            <td
                              key={c.column}
                              className={`whitespace-nowrap px-3 py-2 text-zinc-700 ${c.align === "right" ? "text-right tabular-nums" : ""} ${
                                flagged ? "bg-red-50 ring-1 ring-inset ring-red-300" : ""
                              } ${dimmed ? "opacity-40" : ""}`}
                            >
                              {value ?? <span className="text-xs italic text-red-500">empty</span>}
                            </td>
                          );
                        })}
                        {activeTab === "STOCKED" && (
                          <>
                            <td className="whitespace-nowrap px-3 py-2 text-zinc-700">{item.stockedLocation?.name ?? "—"}</td>
                            <td className="whitespace-nowrap px-3 py-2 text-zinc-500">
                              {item.stockedAt ? new Date(item.stockedAt).toLocaleString() : "—"}
                            </td>
                          </>
                        )}
                        {(activeTab === "INCOMPLETE" || activeTab === "RETURNED") && (
                          <td className="px-3 py-2">
                            <span className="inline-flex flex-wrap gap-1">
                              {(item.missingFields ?? []).map((f) => (
                                <span key={f} className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
                                  {f.replace(/_/g, " ")}
                                </span>
                              ))}
                            </span>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty label={`No ${TAB_LABELS[activeTab].toLowerCase()} rows`} />
          )}
        </CardContent>
      </Card>

      {/* Whole-file reject — only before anything is stocked */}
      {isPending && counts.STOCKED === 0 && (
        <Card className="border-red-200">
          <CardHeader className="pb-2">
            <CardTitle className="text-red-800">Reject the whole file</CardTitle>
            <p className="text-xs text-red-700">The supplier will see your note and resubmit a corrected file.</p>
          </CardHeader>
          <CardContent className="space-y-3">
            <Textarea rows={3} value={rejectNote} onChange={(e) => setRejectNote(e.target.value)} placeholder="Why is this file rejected?" />
            <Button
              variant="danger"
              disabled={!rejectNote.trim() || rejectMutation.isPending}
              onClick={() => rejectMutation.mutate(rejectNote.trim())}
            >
              {rejectMutation.isPending ? "Rejecting..." : "Reject with note"}
            </Button>
          </CardContent>
        </Card>
      )}

      {upload.status === "REJECTED" && upload.vendorNote && (
        <Card className="border-red-200 bg-red-50/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-red-800">Rejection note sent</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-red-700">{upload.vendorNote}</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
