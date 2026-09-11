"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supplierApiFetch } from "@/lib/supplier-api";
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
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Input,
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
  location: { name: string; type: string } | null;
  acceptedAt: string | null;
  createdAt: string;
  items: UploadItem[];
  notifications: Array<{
    id: string;
    type: string;
    message: string;
    createdAt: string;
    readAt: string | null;
  }>;
}

export default function SupplierUploadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { id } = use(params);

  const { data: upload, isLoading } = useQuery({
    queryKey: ["supplier-upload", id],
    queryFn: () => supplierApiFetch<UploadDetail>(`/supplier-portal/uploads/${id}`),
  });

  const [showResubmit, setShowResubmit] = useState(false);
  const [resubmitFile, setResubmitFile] = useState<File | null>(null);
  const [resubmitContent, setResubmitContent] = useState("");
  const [resubmitError, setResubmitError] = useState<string | null>(null);
  const [resubmitLoading, setResubmitLoading] = useState(false);

  const resubmitMutation = useMutation({
    mutationFn: (content: string) =>
      supplierApiFetch(`/supplier-portal/uploads/${id}/resubmit`, {
        method: "POST",
        body: { content },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["supplier-upload", id] });
      queryClient.invalidateQueries({ queryKey: ["supplier-uploads"] });
      queryClient.invalidateQueries({ queryKey: ["supplier-profile"] });
      setShowResubmit(false);
      setResubmitContent("");
      setResubmitFile(null);
    },
  });

  const readResubmitFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setResubmitFile(file);
    setResubmitError(null);
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result;
      if (typeof text === "string") setResubmitContent(text);
    };
    reader.readAsText(file);
  };

  const handleResubmit = () => {
    if (!resubmitContent.trim()) {
      setResubmitError("Please select a corrected CSV file or paste the corrected content");
      return;
    }
    setResubmitLoading(true);
    setResubmitError(null);
    resubmitMutation.mutate(resubmitContent, {
      onError: (err) => {
        setResubmitError(err instanceof Error ? err.message : "Resubmission failed");
      },
      onSettled: () => setResubmitLoading(false),
    });
  };

  if (isLoading || !id) return <Loading />;
  if (!upload) return <Empty label="Upload not found" />;

  const isRejected = upload.status === "REJECTED";
  const isAccepted = upload.status === "ACCEPTED";
  const isIncomplete = upload.status === "INCOMPLETE";
  const statusColor = isAccepted ? "green" : isRejected ? "red" : isIncomplete ? "amber" : "indigo";

  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow="Upload detail"
        title={upload.originalName}
        description={`Submitted ${new Date(upload.createdAt).toLocaleString()} · ${upload.rowCount} rows · Attempt #${upload.submissionCount}`}
        actions={
          <div className="flex gap-2">
            <Badge color={statusColor as any}>{upload.status}</Badge>
            <Link href="/supplier/uploads" className="inline-flex min-h-10 items-center justify-center rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-semibold text-zinc-700 shadow-sm hover:border-zinc-400 hover:bg-zinc-50">
              Back to uploads
            </Link>
          </div>
        }
      />

      {/* Vendor note (rejection) */}
      {isRejected && upload.vendorNote && (
        <Card className="border-red-200 bg-red-50/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-red-800">Vendor feedback</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm leading-6 text-red-700">{upload.vendorNote}</p>
            {!showResubmit && (
              <Button onClick={() => setShowResubmit(true)} className="mt-4">
                Resubmit corrected file
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {/* Acceptance info */}
      {isAccepted && upload.location && (
        <Card className="border-emerald-200 bg-emerald-50/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-emerald-800">Accepted and added to stock</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-emerald-700">
              This shipment was added to <span className="font-semibold">{upload.location.name}</span> on {upload.acceptedAt ? new Date(upload.acceptedAt).toLocaleString() : "—"}. No further action is required.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Incomplete data */}
      {isIncomplete && (
        <Card className="border-amber-200 bg-amber-50/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-amber-800">Missing data — action required</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm leading-6 text-amber-700">
              A few fields in your upload could not be auto-filled from the file data or the product catalog. Fill them in so the vendor can review your submission.
            </p>
            <Link href={`/supplier/uploads/${id}/fix`} className="mt-4 inline-flex min-h-10 items-center justify-center rounded-lg bg-amber-700 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-amber-800">
              Fill in missing fields
            </Link>
          </CardContent>
        </Card>
      )}

      {/* Issues */}
      {upload.issues && upload.issues.length > 0 && (
        <Card className="border-amber-200 bg-amber-50/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-amber-800">Data quality flags</CardTitle>
            <p className="text-xs text-amber-700">These fields were flagged on upload and should be corrected before resubmission.</p>
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

      {/* Resubmit panel */}
      {showResubmit && (
        <Card className="border-teal-200 bg-teal-50/30">
          <CardHeader className="pb-2">
            <CardTitle className="text-teal-800">Resubmit corrected file</CardTitle>
            <p className="text-xs text-teal-700">
              Upload a corrected CSV with the same column headers. The vendor will review your new submission.
            </p>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <label className="grid gap-2 text-sm font-semibold text-zinc-700">
                Select corrected CSV file
                <input
                  type="file"
                  accept=".csv,text/csv"
                  onChange={readResubmitFile}
                  className="min-h-10 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm file:mr-3 file:rounded-lg file:border-0 file:bg-zinc-100 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-zinc-700 hover:file:bg-zinc-200"
                />
              </label>
              {resubmitFile && (
                <div className="rounded-lg border border-zinc-200 bg-white p-3 text-xs text-zinc-600">
                  Selected: {resubmitFile.name}
                </div>
              )}
              <label className="grid gap-2 text-sm font-semibold text-zinc-700">
                Or paste corrected CSV content
                <Textarea
                  value={resubmitContent}
                  onChange={(e) => { setResubmitContent(e.target.value); setResubmitError(null); }}
                  rows={10}
                  className="font-mono text-xs"
                  placeholder="po_number,vendor_id,vendor_name,sku,item_description,category,order_qty,unit_price_bdt,total_amount_bdt,order_date,delivery_date,status"
                />
              </label>
              {resubmitError ? (
                <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{resubmitError}</p>
              ) : null}
              <div className="flex gap-2">
                <Button onClick={handleResubmit} disabled={resubmitLoading || !resubmitContent.trim()}>
                  {resubmitLoading ? "Submitting..." : "Resubmit for review"}
                </Button>
                <Button variant="outline" onClick={() => { setShowResubmit(false); setResubmitContent(""); setResubmitFile(null); }}>
                  Cancel
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Items table */}
      <Card>
        <CardHeader>
          <CardTitle>Product items</CardTitle>
          <p className="mt-1 text-xs text-zinc-500">Rows parsed from your uploaded file</p>
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
                    <th className="whitespace-nowrap px-4 py-3 text-left text-[10px] font-bold uppercase tracking-[0.1em] text-zinc-500">Status</th>
                    {isIncomplete && (
                      <th className="whitespace-nowrap px-4 py-3 text-left text-[10px] font-bold uppercase tracking-[0.1em] text-amber-600">Missing</th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 bg-white">
                  {upload.items.map((item) => (
                    <tr key={item.id} className={`transition-colors hover:bg-teal-50/30 ${item.missingFields?.length ? "bg-amber-50/40" : ""}`}>
                      <td className="px-4 py-3 text-zinc-700">{item.poNumber}</td>
                      <td className="px-4 py-3 font-mono text-xs text-zinc-700">{item.sku}</td>
                      <td className="px-4 py-3 text-zinc-700">{item.itemDescription || <span className="text-red-500 italic">Missing</span>}</td>
                      <td className="px-4 py-3 text-zinc-500">{item.category || "—"}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-zinc-700">{item.orderQty.toLocaleString()}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-zinc-700">{formatMoney(item.unitPriceBdt)}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-zinc-700">{formatMoney(item.totalAmountBdt)}</td>
                      <td className="px-4 py-3 text-zinc-500">{item.status || "—"}</td>
                      {isIncomplete && (
                        <td className="px-4 py-3">
                          {item.missingFields?.length ? (
                            <div className="flex flex-wrap gap-1">
                              {item.missingFields.map((f) => (
                                <span key={f} className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                                  {f.replace("_", " ")}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <span className="text-xs text-emerald-600">Complete</span>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty label="No items parsed" />
          )}
        </CardContent>
      </Card>

      {/* Notifications for this upload */}
      {upload.notifications.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Notifications</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {upload.notifications.map((n) => (
                <div
                  key={n.id}
                  className={`rounded-lg border p-3 text-sm ${
                    n.readAt ? "border-zinc-200 bg-white" : "border-teal-200 bg-teal-50/50"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <Badge color={n.type === "REJECTED" ? "red" : n.type === "ACCEPTED" ? "green" : "indigo"}>{n.type}</Badge>
                    <span className="text-[11px] text-zinc-400">{new Date(n.createdAt).toLocaleString()}</span>
                  </div>
                  <p className="mt-2 text-xs leading-5 text-zinc-600">{n.message}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}