"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Empty,
  Input,
  TableSkeleton,
  PageHeader,
  Select,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
  formatNumber,
} from "@/components/ui";
import { InventoryAdjustmentAction } from "@/components/management/inventory-adjustment-action";

interface InventoryRow {
  productId: string;
  quantity: number;
  reservedQuantity: number;
  location: { id: string; name: string; code: string };
  product: {
    sku: string;
    name: string;
    reorderLevel: number;
    category: { name: string } | null;
    brand: { name: string } | null;
  };
}

interface Paginated<T> {
  data: T[];
  meta: { page: number; limit: number; total: number; totalPages: number };
}

interface Location {
  id: string;
  name: string;
  code: string;
  type: "STORE" | "WAREHOUSE";
}

export default function InventoryPage() {
  return (
    <Suspense>
      <InventoryView />
    </Suspense>
  );
}

function InventoryView() {
  const searchParams = useSearchParams();
  const [locationId, setLocationId] = useState("");
  const [stockStatus, setStockStatus] = useState(searchParams.get("stockStatus") ?? "");
  const [search, setSearch] = useState("");

  const locations = useQuery({
    queryKey: ["locations"],
    queryFn: () => apiFetch<Location[]>("/stores"),
  });

  const inventory = useQuery({
    queryKey: ["inventory", locationId, stockStatus],
    queryFn: () =>
      apiFetch<Paginated<InventoryRow>>(
        `/inventory?page=1&limit=100${locationId ? `&locationId=${locationId}` : ""}${stockStatus ? `&stockStatus=${stockStatus}` : ""}`,
      ),
  });

  const filtered = inventory.data?.data.filter(
    (r) =>
      !search ||
      r.product.name.toLowerCase().includes(search.toLowerCase()) ||
      r.product.sku.toLowerCase().includes(search.toLowerCase()),
  );

  const stockBadge = (row: InventoryRow) => {
    if (row.quantity <= 0) return <Badge color="red">OUT_OF_STOCK</Badge>;
    if (row.quantity <= row.product.reorderLevel) return <Badge color="amber">LOW_STOCK</Badge>;
    return <Badge color="green">IN_STOCK</Badge>;
  };

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Stock control" title="Inventory" description="Review balances across every location and apply auditable stock corrections." actions={<InventoryAdjustmentAction />} />

      <Card>
        <CardContent className="pt-5">
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-full max-w-xs">
              <label htmlFor="inv-search" className="mb-1 block text-xs font-medium text-zinc-500">Search</label>
              <Input id="inv-search" placeholder="Product name or SKU..." value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <div>
              <label htmlFor="inv-location" className="mb-1 block text-xs font-medium text-zinc-500">Location</label>
              <Select id="inv-location" value={locationId} onChange={(e) => setLocationId(e.target.value)} className="max-w-xs">
                <option value="">All locations</option>
                {locations.data?.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name} ({l.code})
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <label htmlFor="inv-status" className="mb-1 block text-xs font-medium text-zinc-500">Stock status</label>
              <Select id="inv-status" value={stockStatus} onChange={(e) => setStockStatus(e.target.value)} className="max-w-xs">
                <option value="">All stock statuses</option>
                <option value="IN_STOCK">IN_STOCK</option>
                <option value="LOW_STOCK">LOW_STOCK</option>
                <option value="OUT_OF_STOCK">OUT_OF_STOCK</option>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{inventory.data ? `${inventory.data.meta.total} inventory records` : "Inventory"}</CardTitle>
        </CardHeader>
        <CardContent>
          {inventory.isLoading ? (
            <TableSkeleton />
          ) : filtered && filtered.length > 0 ? (
            <Table>
              <THead>
                <TR>
                  <TH>Product</TH>
                  <TH>SKU</TH>
                  <TH>Location</TH>
                  <TH className="text-right">Quantity</TH>
                  <TH className="text-right">Available</TH>
                  <TH>Status</TH>
                </TR>
              </THead>
              <TBody>
                {filtered.map((r) => (
                  <TR key={`${r.productId}-${r.location.id}`}>
                    <TD>
                      <div className="font-medium">{r.product.name}</div>
                      {(r.product.brand || r.product.category) && (
                        <div className="text-xs text-zinc-500">
                          {[r.product.brand?.name, r.product.category?.name].filter(Boolean).join(" · ")}
                        </div>
                      )}
                    </TD>
                    <TD className="font-mono text-xs">{r.product.sku}</TD>
                    <TD>{r.location.name}</TD>
                    <TD className="text-right">{formatNumber(r.quantity)}</TD>
                    <TD className="text-right">{formatNumber(r.quantity - r.reservedQuantity)}</TD>
                    <TD>{stockBadge(r)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          ) : (
            <Empty label="No inventory records" hint="Receive a purchase or adjust stock to create balances." />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
