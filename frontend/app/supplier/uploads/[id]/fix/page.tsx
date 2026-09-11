"use client";

import { use, useState } from "react";
import Link from "next/link";
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
  Input,
  Loading,
  PageHeader,
  formatMoney,
} from "@/components/ui";

const FIELD_LABELS: Record<string, string> = {
  po_number: "PO Number",
  sku: "SKU",
  item_description: "Item Description",
  order_qty: "Order Quantity",
  unit_price_bdt: "Unit Price (BDT)",
  total_amount_bdt: "Total Amount (BDT)",
};

const FIELD_TO_API_KEY: Record<string, string> = {
  po_number: "poNumber",
  sku: "sku",
  item_description: "itemDescription",
  order_qty: "orderQty",
  unit_price_bdt: "unitPriceBdt",
  total_amount_bdt: "totalAmountBdt",
};

const NUMERIC_FIELDS = new Set(["order_qty", "unit_price_bdt", "total_amount_bdt"]);

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
  items: UploadItem[];
}

export default function SupplierUploadFixPage({ params }: { params: Promise<{ id: string }> }) {
  const queryClient = useQueryClient();
  const { id } = use(params);

  const { data: upload, isLoading } = useQuery({
    queryKey: ["supplier-upload", id],
    queryFn: () => supplierApiFetch<UploadDetail>(`/supplier-portal/uploads/${id}`),
  });

  const [edits, setEdits] = useState<Record<string, Record<string, string>>>({});
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const fixMutation = useMutation({
    mutationFn: (items: Array<{ id: string; [key: string]: unknown }>) =>
      supplierApiFetch(`/supplier-portal/uploads/${id}/fix`, {
        method: "POST",
        body: { items },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["supplier-upload", id] });
      queryClient.invalidateQueries({ queryKey: ["supplier-uploads"] });
      queryClient.invalidateQueries({ queryKey: ["supplier-profile"] });
      queryClient.invalidateQueries({ queryKey: ["supplier-notifications"] });
      setSuccess(true);
    },
  });

  const setFieldValue = (itemId: string, field: string, value: string) => {
    setEdits((prev) => ({
      ...prev,
      [itemId]: { ...(prev[itemId] ?? {}), [field]: value },
    }));
  };

  const handleSubmit = () => {
    setError(null);
    if (!upload) return;

    const incompleteItems = upload.items.filter(
      (item) => item.missingFields && item.missingFields.length > 0,
    );

    const items = incompleteItems.map((item) => {
      const itemEdits = edits[item.id] ?? {};
      const payload: Record<string, unknown> = { id: item.id };
      for (const field of item.missingFields) {
        const key = FIELD_TO_API_KEY[field] ?? field;
        const value = itemEdits[field] ?? "";
        payload[key] = NUMERIC_FIELDS.has(field) ? Number(value) : value;
      }
      return payload;
    });

    const missingEmpty = incompleteItems.filter((item) => {
      const itemEdits = edits[item.id] ?? {};
      return item.missingFields.some((f) => !(itemEdits[f] ?? "").trim());
    });

    if (missingEmpty.length > 0) {
      const labels = missingEmpty
        .map((item) => {
          const unfilled = item.missingFields.filter((f) => !(edits[item.id]?.[f] ?? "").trim());
          return `"${item.sku || item.poNumber || "(row)"}": ${unfilled.map((f) => FIELD_LABELS[f] || f).join(", ")}`;
        })
        .join("; ");
      setError(`Please fill in all missing fields: ${labels}`);
      return;
    }

    fixMutation.mutate(items as Array<{ id: string; [key: string]: unknown }>, {
      onError: (err) => {
        setError(err instanceof Error ? err.message : "Failed to submit fixes");
      },
    });
  };

  if (isLoading) return <Loading />;
  if (!upload) return <Empty label="Upload not found" />;

  if (success) {
    return (
      <div className="space-y-7">
        <PageHeader
          eyebrow="Upload fixed"
          title="Missing fields submitted"
          description="Your upload is now pending vendor review."
        />
        <div className="flex gap-2">
          <Link href={`/supplier/uploads/${id}`}>
            <Button>View upload detail</Button>
          </Link>
          <Link href="/supplier/uploads">
            <Button variant="outline">Back to uploads</Button>
          </Link>
        </div>
      </div>
    );
  }

  if (upload.status !== "INCOMPLETE") {
    return (
      <div className="space-y-7">
        <PageHeader
          eyebrow="Upload detail"
          title="This upload is not incomplete"
          description="Only uploads with missing data can be fixed from this page."
        />
        <Link href={`/supplier/uploads/${id}`}>
          <Button>Back to upload detail</Button>
        </Link>
      </div>
    );
  }

  const incompleteItems = upload.items.filter(
    (item) => item.missingFields && item.missingFields.length > 0,
  );
  const completeItems = upload.items.filter(
    (item) => !item.missingFields || item.missingFields.length === 0,
  );

  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow="Fix missing data"
        title={upload.originalName}
        description={`The system could not auto-fill these fields. Fill in the missing values below. ${incompleteItems.length} of ${upload.items.length} rows need attention.`}
        actions={
          <Link href={`/supplier/uploads/${id}`} className="inline-flex min-h-10 items-center justify-center rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-semibold text-zinc-700 shadow-sm hover:border-zinc-400 hover:bg-zinc-50">
            Back to upload detail
          </Link>
        }
      />

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>
      )}

      {incompleteItems.length === 0 ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-6 text-center text-sm text-emerald-700">
          All missing fields have been filled in. Submit to send for vendor review.
        </div>
      ) : (
        <div className="space-y-4">
          {incompleteItems.map((item, idx) => {
            const itemEdits = edits[item.id] ?? {};
            const missingFields = item.missingFields;
            return (
              <Card key={item.id} className="border-amber-200">
                <CardHeader className="pb-3">
                  <div className="flex items-center gap-3">
                    <Badge color="amber">Row {idx + 1}</Badge>
                    {item.sku && (
                      <span className="font-mono text-xs text-zinc-600">SKU: {item.sku}</span>
                    )}
                    {item.poNumber && (
                      <span className="text-xs text-zinc-500">PO: {item.poNumber}</span>
                    )}
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {missingFields.map((field) => {
                      const label = FIELD_LABELS[field] || field;
                      const isNumeric = field === "order_qty" || field === "unit_price_bdt" || field === "total_amount_bdt";
                      return (
                        <label key={field} className="grid gap-1.5 text-sm font-semibold text-zinc-700">
                          {label}
                          <Input
                            type={isNumeric ? "number" : "text"}
                            step={isNumeric && (field === "unit_price_bdt" || field === "total_amount_bdt") ? "0.01" : undefined}
                            min={isNumeric ? "0" : undefined}
                            placeholder={`Enter ${label.toLowerCase()}`}
                            value={itemEdits[field] ?? ""}
                            onChange={(e) => setFieldValue(item.id, field, e.target.value)}
                          />
                        </label>
                      );
                    })}
                  </div>
                  {missingFields.length > 1 && (
                    <p className="mt-3 text-xs text-amber-600">
                      This row needs {missingFields.length} field(s) filled in: {missingFields.map((f) => FIELD_LABELS[f] || f).join(", ")}.
                    </p>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {completeItems.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-zinc-500">
              {completeItems.length} row{completeItems.length !== 1 && "s"} already complete
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="w-full overflow-x-auto rounded-lg border border-zinc-200">
              <table className="w-full text-sm">
                <thead className="border-b border-zinc-200 bg-zinc-50/80">
                  <tr>
                    <th className="whitespace-nowrap px-4 py-2 text-left text-[10px] font-bold uppercase tracking-[0.1em] text-zinc-500">PO #</th>
                    <th className="whitespace-nowrap px-4 py-2 text-left text-[10px] font-bold uppercase tracking-[0.1em] text-zinc-500">SKU</th>
                    <th className="whitespace-nowrap px-4 py-2 text-left text-[10px] font-bold uppercase tracking-[0.1em] text-zinc-500">Description</th>
                    <th className="whitespace-nowrap px-4 py-2 text-right text-[10px] font-bold uppercase tracking-[0.1em] text-zinc-500">Qty</th>
                    <th className="whitespace-nowrap px-4 py-2 text-right text-[10px] font-bold uppercase tracking-[0.1em] text-zinc-500">Unit Price</th>
                    <th className="whitespace-nowrap px-4 py-2 text-right text-[10px] font-bold uppercase tracking-[0.1em] text-zinc-500">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 bg-white">
                  {completeItems.map((item) => (
                    <tr key={item.id} className="text-zinc-500">
                      <td className="px-4 py-2">{item.poNumber}</td>
                      <td className="px-4 py-2 font-mono text-xs">{item.sku}</td>
                      <td className="px-4 py-2">{item.itemDescription}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{item.orderQty.toLocaleString()}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{formatMoney(item.unitPriceBdt)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{formatMoney(item.totalAmountBdt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex gap-3">
        <Button onClick={handleSubmit} disabled={fixMutation.isPending || incompleteItems.length === 0}>
          {fixMutation.isPending ? "Submitting..." : "Submit fixes and send for review"}
        </Button>
        <Link href={`/supplier/uploads/${id}`}>
          <Button variant="outline" type="button">
            Cancel
          </Button>
        </Link>
      </div>
    </div>
  );
}
