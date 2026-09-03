"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { Button, Input, Select, Textarea } from "@/components/ui";
import { Dialog, Field, FormError } from "@/components/management/dialog";

interface CatalogItem { id: string; name: string; parentId?: string | null }
interface ProductValue {
  id: string;
  sku: string;
  name: string;
  description: string | null;
  unit: string;
  costPrice: string;
  sellingPrice: string;
  reorderLevel: number;
  status: string;
  category: CatalogItem | null;
  brand: CatalogItem | null;
}
interface VariantDraft { key: string; sku: string; barcode: string; size: string; color: string }

const newVariant = (): VariantDraft => ({ key: crypto.randomUUID(), sku: "", barcode: "", size: "", color: "" });

export function ProductAction({ product }: { product?: ProductValue }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(product?.name ?? "");
  const [sku, setSku] = useState(product?.sku ?? "");
  const [description, setDescription] = useState(product?.description ?? "");
  const [unit, setUnit] = useState(product?.unit ?? "pcs");
  const [costPrice, setCostPrice] = useState(product?.costPrice ?? "0");
  const [sellingPrice, setSellingPrice] = useState(product?.sellingPrice ?? "0");
  const [reorderLevel, setReorderLevel] = useState(String(product?.reorderLevel ?? 0));
  const [status, setStatus] = useState(product?.status ?? "ACTIVE");
  const [categoryId, setCategoryId] = useState(product?.category?.id ?? "");
  const [brandId, setBrandId] = useState(product?.brand?.id ?? "");
  const [variants, setVariants] = useState<VariantDraft[]>([]);
  const [newCategory, setNewCategory] = useState("");
  const [parentId, setParentId] = useState("");
  const [newBrand, setNewBrand] = useState("");
  const editing = Boolean(product);
  const queryClient = useQueryClient();

  const categories = useQuery({
    queryKey: ["categories"],
    queryFn: () => apiFetch<CatalogItem[]>("/products/categories"),
    enabled: open,
  });
  const brands = useQuery({
    queryKey: ["brands"],
    queryFn: () => apiFetch<CatalogItem[]>("/products/brands"),
    enabled: open,
  });

  const save = useMutation({
    mutationFn: () => apiFetch<ProductValue>(product ? `/products/${product.id}` : "/products", {
      method: product ? "PATCH" : "POST",
      body: product
        ? {
            name: name.trim(),
            description: description.trim(),
            unit: unit.trim(),
            costPrice: Number(costPrice),
            sellingPrice: Number(sellingPrice),
            reorderLevel: Number(reorderLevel),
            categoryId: categoryId || null,
            brandId: brandId || null,
            status,
          }
        : {
            sku: sku.trim().toUpperCase(),
            name: name.trim(),
            ...(description.trim() ? { description: description.trim() } : {}),
            unit: unit.trim(),
            costPrice: Number(costPrice),
            sellingPrice: Number(sellingPrice),
            reorderLevel: Number(reorderLevel),
            ...(categoryId ? { categoryId } : {}),
            ...(brandId ? { brandId } : {}),
            ...(variants.length ? {
              variants: variants.map((variant) => ({
                sku: variant.sku.trim().toUpperCase(),
                ...(variant.barcode.trim() ? { barcode: variant.barcode.trim() } : {}),
                ...(variant.size.trim() ? { size: variant.size.trim() } : {}),
                ...(variant.color.trim() ? { color: variant.color.trim() } : {}),
              })),
            } : {}),
          },
    }),
    onSuccess: async (saved) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["products"] }),
        queryClient.invalidateQueries({ queryKey: ["product", saved.id] }),
        queryClient.invalidateQueries({ queryKey: ["inventory"] }),
        queryClient.invalidateQueries({ queryKey: ["pos-products"] }),
        queryClient.invalidateQueries({ queryKey: ["overview"] }),
      ]);
      setOpen(false);
    },
  });

  const createCategory = useMutation({
    mutationFn: () => apiFetch<CatalogItem>("/products/categories", {
      method: "POST",
      body: { name: newCategory.trim(), ...(parentId ? { parentId } : {}) },
    }),
    onSuccess: async (category) => {
      setCategoryId(category.id);
      setNewCategory("");
      setParentId("");
      await queryClient.invalidateQueries({ queryKey: ["categories"] });
    },
  });

  const createBrand = useMutation({
    mutationFn: () => apiFetch<CatalogItem>("/products/brands", { method: "POST", body: { name: newBrand.trim() } }),
    onSuccess: async (brand) => {
      setBrandId(brand.id);
      setNewBrand("");
      await queryClient.invalidateQueries({ queryKey: ["brands"] });
    },
  });

  const close = () => {
    if (!save.isPending && !createCategory.isPending && !createBrand.isPending) setOpen(false);
  };

  return (
    <>
      <Button type="button" variant={editing ? "outline" : "primary"} onClick={() => setOpen(true)}>
        {editing ? "Edit product" : "New product"}
      </Button>
      <Dialog open={open} title={editing ? "Edit product" : "Create product"} description="Configure catalog details, pricing, stock thresholds, and optional variants." size="xl" onClose={close}>
        <form className="space-y-6" onSubmit={(event) => { event.preventDefault(); save.mutate(); }}>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Product name"><Input required autoFocus maxLength={200} value={name} onChange={(event) => setName(event.target.value)} /></Field>
            <Field label="SKU" hint={editing ? "The base SKU cannot be changed." : "Unique within your organization."}>
              <Input required maxLength={64} disabled={editing} value={sku} onChange={(event) => setSku(event.target.value)} />
            </Field>
          </div>
          <Field label="Description"><Textarea rows={3} maxLength={1000} value={description} onChange={(event) => setDescription(event.target.value)} /></Field>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Unit"><Input required maxLength={20} value={unit} onChange={(event) => setUnit(event.target.value)} /></Field>
            <Field label="Cost price"><Input required type="number" min="0" step="0.01" value={costPrice} onChange={(event) => setCostPrice(event.target.value)} /></Field>
            <Field label="Selling price"><Input required type="number" min="0" step="0.01" value={sellingPrice} onChange={(event) => setSellingPrice(event.target.value)} /></Field>
            <Field label="Reorder level"><Input required type="number" min="0" step="1" value={reorderLevel} onChange={(event) => setReorderLevel(event.target.value)} /></Field>
          </div>

          <div className="grid gap-5 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800 lg:grid-cols-2">
            <div className="space-y-3">
              <Field label="Category">
                <Select className="w-full" value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
                  <option value="">No category</option>
                  {categories.data?.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
                </Select>
              </Field>
              <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                <Input aria-label="New category name" placeholder="New category" maxLength={120} value={newCategory} onChange={(event) => setNewCategory(event.target.value)} />
                <Select aria-label="Parent category" value={parentId} onChange={(event) => setParentId(event.target.value)}>
                  <option value="">No parent</option>
                  {categories.data?.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
                </Select>
                <Button type="button" variant="secondary" disabled={!newCategory.trim() || createCategory.isPending} onClick={() => createCategory.mutate()}>Add</Button>
              </div>
              <FormError error={createCategory.error} />
            </div>
            <div className="space-y-3">
              <Field label="Brand">
                <Select className="w-full" value={brandId} onChange={(event) => setBrandId(event.target.value)}>
                  <option value="">No brand</option>
                  {brands.data?.map((brand) => <option key={brand.id} value={brand.id}>{brand.name}</option>)}
                </Select>
              </Field>
              <div className="flex gap-2">
                <Input aria-label="New brand name" placeholder="New brand" maxLength={120} value={newBrand} onChange={(event) => setNewBrand(event.target.value)} />
                <Button type="button" variant="secondary" disabled={!newBrand.trim() || createBrand.isPending} onClick={() => createBrand.mutate()}>Add</Button>
              </div>
              <FormError error={createBrand.error} />
            </div>
          </div>

          {editing ? (
            <Field label="Status">
              <Select className="w-full sm:w-64" value={status} onChange={(event) => setStatus(event.target.value)}>
                <option value="ACTIVE">Active</option>
                <option value="INACTIVE">Inactive</option>
                <option value="DISCONTINUED">Discontinued</option>
              </Select>
            </Field>
          ) : (
            <section className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="font-semibold text-zinc-900 dark:text-zinc-100">Variants</h3>
                  <p className="text-xs text-zinc-500">Optional size, color, SKU, and barcode combinations.</p>
                </div>
                <Button type="button" variant="outline" onClick={() => setVariants((current) => [...current, newVariant()])}>Add variant</Button>
              </div>
              {variants.map((variant, index) => (
                <div key={variant.key} className="grid gap-2 rounded-lg bg-zinc-50 p-3 dark:bg-zinc-950 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_1fr_auto]">
                  <Input aria-label={`Variant ${index + 1} SKU`} required placeholder="Variant SKU" value={variant.sku} onChange={(event) => setVariants((current) => current.map((item) => item.key === variant.key ? { ...item, sku: event.target.value } : item))} />
                  <Input aria-label={`Variant ${index + 1} barcode`} placeholder="Barcode" value={variant.barcode} onChange={(event) => setVariants((current) => current.map((item) => item.key === variant.key ? { ...item, barcode: event.target.value } : item))} />
                  <Input aria-label={`Variant ${index + 1} size`} placeholder="Size" value={variant.size} onChange={(event) => setVariants((current) => current.map((item) => item.key === variant.key ? { ...item, size: event.target.value } : item))} />
                  <Input aria-label={`Variant ${index + 1} color`} placeholder="Color" value={variant.color} onChange={(event) => setVariants((current) => current.map((item) => item.key === variant.key ? { ...item, color: event.target.value } : item))} />
                  <Button type="button" variant="ghost" onClick={() => setVariants((current) => current.filter((item) => item.key !== variant.key))}>Remove</Button>
                </div>
              ))}
            </section>
          )}

          <FormError error={save.error} />
          <div className="flex justify-end gap-2 border-t border-zinc-200 pt-4 dark:border-zinc-800">
            <Button type="button" variant="ghost" disabled={save.isPending} onClick={close}>Cancel</Button>
            <Button type="submit" disabled={save.isPending}>{save.isPending ? "Saving..." : editing ? "Save changes" : "Create product"}</Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
