"use client";

import Link from "next/link";
import { use, useState } from "react";
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

interface UploadItem {
  id: string;
  poNumber: string;
  vendorId: string;
  vendorName: string;
  sku: string;
  itemDescription: string;
  category: string;
  orderQty: number;
  unitPriceBdt: number;
  totalAmountBdt: number;
  orderDate: string;
  deliveryDate: string;
  status: string;
  missingFields: string[];
}

interface UploadDetail {
  id: string;
  originalName: string;
  status: string;
  rowCount: number;
  submissionCount: number;
  vendorNote: string | null;
  issues: Array<{ row: number; field: string; message: string }> | null;
  acceptedAt: string | null;
  createdAt: string;
  supplierUser: { id: string; name: string; email: string; phone: string | null };
  location: { id: string; name: string; type: string } | null;
  items: UploadItem[];
}

interface Store {
  id: string;
  name: string;
  code: string;
  type: string;
}

interface AcceptResult {
  id: string;
  createdProducts: number;
  existingProducts: number;
  skippedCount: number;
  location: { id: string; name: string };
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

  const [locationId, setLocationId] = useState("");
  const [accepting, setAccepting] = useState(false);
  const [acceptResult, setAcceptResult] = useState<AcceptResult | null>(null);

  const [rejectNote, setRejectNote] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const [rejectError, setRejectError] = useState<string | null>(null);

  const acceptMutation = useMutation({
    mutationFn: (lid: string) =>
      apiFetch(`/supplier-portal/manage/uploads/${id}/accept`, {
        method: "POST",
        body: { locationId: lid },
      }),
    onSuccess: (data: any) => {
      setAcceptResult(data as AcceptResult);
      queryClient.invalidateQueries({ queryKey: ["manage-supplier-upload", id] });
      queryClient.invalidateQueries({ queryKey: ["manage-supplier-uploads"] });
    },
    onError: (err: any) => alert(err.message || "Accept failed"),
  });

  const rejectMutation = useMutation({
    mutationFn: (note: string) =>
      apiFetch(`/supplier-portal/manage/uploads/${id}/reject`, {
        method: "POST",
        body: { note },
      }),
    onSuccess: () => {
      setRejectNote("");
      queryClient.invalidateQueries({ queryKey: ["manage-supplier-upload", id] });
      queryClient.invalidateQueries({ queryKey: ["manage-supplier-uploads"] });
    },
    onError: (err: any) => {
      setRejectError(err.message || "Reject failed");
      setRejecting(false);
    },
  });

  const handleAccept = () => {
    if (!locationId) return;
    setAccepting(true);
    acceptMutation.mutate(locationId, {
      onSettled: () => setAccepting(false),
    });
  };

  const handleReject = () => {
    if (!rejectNote.trim()) {
      setRejectError("Please enter a note explaining what data is missing or needs correction.");
      return;
    }
    setRejectError(null);
    setRejecting(true);
    rejectMutation.mutate(rejectNote, {
      onSettled: () => setRejecting(false),
    });
  };

  if (isLoading || !id) return <Loading />;
  if (!upload) return <Empty label="Upload not found" />;

  const isPending = upload.status === "PENDING";
  const isAccepted = upload.status === "ACCEPTED";
  const isRejected = upload.status === "REJECTED";
  const isIncomplete = upload.status === "INCOMPLETE";
  const statusColor = isAccepted ? "green" : isRejected ? "red" : isIncomplete ? "amber" : "indigo";

  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow="Supplier upload review"
        title={upload.originalName}
        description={`From ${upload.supplierUser.name} · Submitted ${new Date(upload.createdAt).toLocaleString()} · ${upload.rowCount} rows · Attempt #${upload.submissionCount}`}
        actions={
          <div className="flex gap-2">
            <Badge color={statusColor as any}>{upload.status}</Badge>
            <Link
              href="/supplier-uploads"
              className="inline-flex min-h-10 items-center justify-center rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-semibold text-zinc-700 shadow-sm hover:border-zinc-400 hover:bg-zinc-50"
            >
              Back to queue
            </Link>
          </div>
        }
      />

      {/* Supplier info */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle>Supplier</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <p className="text-sm font-semibold text-zinc-800">{upload.supplierUser.name}</p>
              <p className="text-xs text-zinc-500">{upload.supplierUser.email}</p>
              {upload.supplierUser.phone && <p className="text-xs text-zinc-500">{upload.supplierUser.phone}</p>}
            </div>
            <div className="text-right">
              <p className="text-xs text-zinc-500">Accepted to</p>
              <p className="text-sm font-semibold text-zinc-800">{upload.location?.name ?? "—"}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Issues */}
      {upload.issues && upload.issues.length > 0 && (
        <Card className="border-amber-200 bg-amber-50/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-amber-800">Data quality flags</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1 text-sm text-amber-700">
              {upload.issues.map((issue, i) => (
                <li key={i}>Row {issue.row}: <span className="font-semibold">{issue.field}</span> — {issue.message}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Incomplete notice */}
      {isIncomplete && (
        <Card className="border-amber-200 bg-amber-50/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-amber-800">Awaiting supplier fixes</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-amber-700">
              This upload has rows with missing data that could not be auto-filled from the file or the product
              catalog. The supplier has been notified and will need to fill in the missing fields before you can
              review it. You will be notified once the upload is ready.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Accept / Reject panels */}
      {isPending && !acceptResult && (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <Card className="border-emerald-200">
            <CardHeader className="pb-2">
              <CardTitle className="text-emerald-800">Accept shipment</CardTitle>
              <p className="text-xs text-emerald-700">
                Products will be added to the selected store. Existing products by SKU will be updated; new products will be created.
              </p>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <label className="grid gap-2 text-sm font-semibold text-zinc-700">
                  Select store or warehouse
                  <Select value={locationId} onChange={(e) => setLocationId(e.target.value)}>
                    <option value="">Choose a location...</option>
                    {stores?.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} ({s.type === "WAREHOUSE" ? "Warehouse" : "Store"})
                      </option>
                    ))}
                  </Select>
                </label>
                <Button disabled={!locationId || accepting} onClick={handleAccept} className="w-full">
                  {accepting ? "Adding to stock..." : "Accept and add to stock"}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card className="border-red-200">
            <CardHeader className="pb-2">
              <CardTitle className="text-red-800">Reject and request correction</CardTitle>
              <p className="text-xs text-red-700">
                The supplier will see your note and be able to correct the data and resubmit.
              </p>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <label className="grid gap-2 text-sm font-semibold text-zinc-700">
                  Rejection note (required)
                  <Textarea
                    value={rejectNote}
                    onChange={(e) => { setRejectNote(e.target.value); setRejectError(null); }}
                    rows={4}
                    placeholder="e.g. Row 2 is missing the item_description. Please fill in the missing data and resubmit."
                  />
                </label>
                {rejectError ? (
                  <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{rejectError}</p>
                ) : null}
                <Button variant="danger" disabled={rejecting || !rejectNote.trim()} onClick={handleReject} className="w-full">
                  {rejecting ? "Submitting rejection..." : "Reject with note"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Acceptance result */}
      {acceptResult && (
        <Card className="border-emerald-200 bg-emerald-50/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-emerald-800">Shipment accepted</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <p className="text-xs text-emerald-700">New products created</p>
                <p className="text-2xl font-semibold text-emerald-900">{acceptResult.createdProducts}</p>
              </div>
              <div>
                <p className="text-xs text-emerald-700">Existing products updated</p>
                <p className="text-2xl font-semibold text-emerald-900">{acceptResult.existingProducts}</p>
              </div>
              <div>
                <p className="text-xs text-emerald-700">Stock added to</p>
                <p className="text-lg font-semibold text-emerald-900">{acceptResult.location.name}</p>
              </div>
            </div>
            {acceptResult.skippedCount > 0 && (
              <p className="mt-3 text-xs text-amber-700">
                {acceptResult.skippedCount} row(s) were skipped (missing SKU or quantity ≤ 0).
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Rejection note (when rejected) */}
      {isRejected && upload.vendorNote && (
        <Card className="border-red-200 bg-red-50/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-red-800">Rejection note sent</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-red-700">{upload.vendorNote}</p>
          </CardContent>
        </Card>
      )}

      {/* Items table */}
      <Card>
        <CardHeader>
          <CardTitle>Product items ({upload.items.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {upload.items.length > 0 ? (
            <div className="w-full overflow-x-auto rounded-lg border border-zinc-200">
              <table className="w-full text-sm">
                <thead className="border-b border-zinc-200 bg-zinc-50/80">
                  <tr>
                    <th className="whitespace-nowrap px-4 py-3 text-left text-[10px] font-bold uppercase tracking-[0.1em] text-zinc-500">PO #</th>
                    <th className="whitespace-nowrap px-4 py-3 text-left text-[10px] font-bold uppercase tracking-[0.1em] text-zinc-500">SKU</th>
                    <th className="whitespace-nowrap px-4 py-3 text-left text-[10px] font-bold uppercase tracking-[0.1em] text-zinc-500">Description</th>
                    <th className="whitespace-nowrap px-4 py-3 text-left text-[10px] font-bold uppercase tracking-[0.1em] text-zinc-500">Category</th>
                    <th className="whitespace-nowrap px-4 py-3 text-right text-[10px] font-bold uppercase tracking-[0.1em] text-zinc-500">Qty</th>
                    <th className="whitespace-nowrap px-4 py-3 text-right text-[10px] font-bold uppercase tracking-[0.1em] text-zinc-500">Unit Price</th>
                    <th className="whitespace-nowrap px-4 py-3 text-right text-[10px] font-bold uppercase tracking-[0.1em] text-zinc-500">Total</th>
                    <th className="whitespace-nowrap px-4 py-3 text-left text-[10px] font-bold uppercase tracking-[0.1em] text-zinc-500">Delivery</th>
                    <th className="whitespace-nowrap px-4 py-3 text-left text-[10px] font-bold uppercase tracking-[0.1em] text-zinc-500">Missing</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 bg-white">
                  {upload.items.map((item) => (
                    <tr key={item.id} className="transition-colors hover:bg-teal-50/30">
                      <td className="px-4 py-3 text-zinc-700">{item.poNumber}</td>
                      <td className="px-4 py-3 font-mono text-xs text-zinc-700">{item.sku}</td>
                      <td className="px-4 py-3 text-zinc-700">{item.itemDescription || <span className="text-red-500 italic">Missing</span>}</td>
                      <td className="px-4 py-3 text-zinc-500">{item.category || "—"}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-zinc-700">{item.orderQty.toLocaleString()}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-zinc-700">{formatMoney(item.unitPriceBdt)}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-zinc-700">{formatMoney(item.totalAmountBdt)}</td>
                      <td className="px-4 py-3 text-zinc-500">{item.deliveryDate || "—"}</td>
                      <td className="px-4 py-3 text-zinc-500">
                        {item.missingFields && item.missingFields.length > 0 ? (
                          <span className="inline-flex flex-wrap gap-1">
                            {item.missingFields.map((f) => (
                              <span key={f} className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
                                {f.replace(/_/g, " ")}
                              </span>
                            ))}
                          </span>
                        ) : (
                          <span className="text-zinc-300">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty label="No items" />
          )}
        </CardContent>
      </Card>
    </div>
  );
}