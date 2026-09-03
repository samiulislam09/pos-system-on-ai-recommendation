"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { Button, Input, Select, Textarea } from "@/components/ui";
import { Dialog, Field, FormError } from "@/components/management/dialog";

interface ProductOption { id: string; sku: string; name: string }
interface LocationOption { id: string; code: string; name: string; type: string }
interface ProductPage { data: ProductOption[] }
interface AdjustmentRow { key: string; productId: string; quantity: string }

const reasons = ["MANUAL_CORRECTION", "STOCK_COUNT_VARIANCE", "FOUND", "DAMAGED", "LOST", "OTHER"] as const;
const createRow = (productId = ""): AdjustmentRow => ({ key: crypto.randomUUID(), productId, quantity: "" });

export function InventoryAdjustmentAction({ product }: { product?: ProductOption }) {
  const [open, setOpen] = useState(false);
  const [locationId, setLocationId] = useState("");
  const [reason, setReason] = useState<(typeof reasons)[number]>("MANUAL_CORRECTION");
  const [notes, setNotes] = useState("");
  const [rows, setRows] = useState<AdjustmentRow[]>(() => [createRow(product?.id)]);
  const queryClient = useQueryClient();

  const locations = useQuery({
    queryKey: ["locations"],
    queryFn: () => apiFetch<LocationOption[]>("/stores"),
    enabled: open,
  });
  const products = useQuery({
    queryKey: ["products", "adjustment-options"],
    queryFn: () => apiFetch<ProductPage>("/products?page=1&limit=100&status=ACTIVE"),
    enabled: open,
  });

  const mutation = useMutation({
    mutationFn: () => apiFetch("/inventory/adjust", {
      method: "POST",
      body: {
        locationId,
        reason,
        items: rows.map((row) => ({ productId: row.productId, quantity: Number(row.quantity), reason })),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      },
    }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["inventory"] }),
        queryClient.invalidateQueries({ queryKey: ["products"] }),
        queryClient.invalidateQueries({ queryKey: ["product"] }),
        queryClient.invalidateQueries({ queryKey: ["store", locationId] }),
        queryClient.invalidateQueries({ queryKey: ["pos-products"] }),
        queryClient.invalidateQueries({ queryKey: ["overview"] }),
      ]);
      setNotes("");
      setRows([createRow(product?.id)]);
      setOpen(false);
    },
  });

  const selected = new Set(rows.map((row) => row.productId).filter(Boolean));
  const valid = Boolean(locationId && rows.length && rows.every((row) => row.productId && Number.isInteger(Number(row.quantity)) && Number(row.quantity) !== 0));

  return (
    <>
      <Button type="button" variant={product ? "outline" : "primary"} onClick={() => setOpen(true)}>Adjust stock</Button>
      <Dialog
        open={open}
        title="Adjust inventory"
        description="Enter signed quantities: positive values add stock and negative values remove it."
        size="lg"
        onClose={() => !mutation.isPending && setOpen(false)}
      >
        <form className="space-y-5" onSubmit={(event) => { event.preventDefault(); if (valid) mutation.mutate(); }}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Location">
              <Select className="w-full" required value={locationId} onChange={(event) => setLocationId(event.target.value)}>
                <option value="">Select a store or warehouse</option>
                {locations.data?.map((location) => <option key={location.id} value={location.id}>{location.name} ({location.code})</option>)}
              </Select>
            </Field>
            <Field label="Reason">
              <Select className="w-full" value={reason} onChange={(event) => setReason(event.target.value as (typeof reasons)[number])}>
                {reasons.map((item) => <option key={item} value={item}>{item.replaceAll("_", " ")}</option>)}
              </Select>
            </Field>
          </div>

          <section className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h3 className="font-semibold text-zinc-900 dark:text-zinc-100">Products</h3>
              <Button type="button" variant="outline" onClick={() => setRows((current) => [...current, createRow()])}>Add line</Button>
            </div>
            {rows.map((row, index) => (
              <div key={row.key} className="grid gap-2 rounded-lg bg-zinc-50 p-3 dark:bg-zinc-950 sm:grid-cols-[1fr_10rem_auto]">
                <Select
                  aria-label={`Product ${index + 1}`}
                  required
                  className="w-full"
                  value={row.productId}
                  disabled={Boolean(product && index === 0)}
                  onChange={(event) => setRows((current) => current.map((item) => item.key === row.key ? { ...item, productId: event.target.value } : item))}
                >
                  <option value="">Select product</option>
                  {product && row.productId === product.id ? <option value={product.id}>{product.name} ({product.sku})</option> : null}
                  {products.data?.data
                    .filter((item) => item.id !== product?.id || row.productId !== product.id)
                    .map((item) => <option key={item.id} value={item.id} disabled={selected.has(item.id) && item.id !== row.productId}>{item.name} ({item.sku})</option>)}
                </Select>
                <Input
                  aria-label={`Quantity ${index + 1}`}
                  required
                  type="number"
                  step="1"
                  placeholder="e.g. 10 or -2"
                  value={row.quantity}
                  onChange={(event) => setRows((current) => current.map((item) => item.key === row.key ? { ...item, quantity: event.target.value } : item))}
                />
                <Button type="button" variant="ghost" disabled={rows.length === 1} onClick={() => setRows((current) => current.filter((item) => item.key !== row.key))}>Remove</Button>
              </div>
            ))}
          </section>

          <Field label="Notes"><Textarea rows={3} maxLength={500} value={notes} onChange={(event) => setNotes(event.target.value)} /></Field>
          {reason === "STOCK_COUNT_VARIANCE" ? <p className="rounded-lg border border-teal-200 bg-teal-50 p-3 text-xs text-teal-800">Stock count variance can reduce a balance below zero. Review quantities carefully before submitting.</p> : null}
          <FormError error={mutation.error} />
          <div className="flex justify-end gap-2 border-t border-zinc-200 pt-4 dark:border-zinc-800">
            <Button type="button" variant="ghost" disabled={mutation.isPending} onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={!valid || mutation.isPending}>{mutation.isPending ? "Applying..." : "Apply adjustment"}</Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
