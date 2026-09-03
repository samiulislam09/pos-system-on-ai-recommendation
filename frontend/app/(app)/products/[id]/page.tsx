"use client";

import { use } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Empty,
  Loading,
  PageHeader,
  StatCard,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
  formatDate,
  formatMoney,
  formatNumber,
} from "@/components/ui";
import { InventoryAdjustmentAction } from "@/components/management/inventory-adjustment-action";
import { ProductAction } from "@/components/management/product-actions";

interface ProductDetail {
  id: string;
  sku: string;
  name: string;
  description: string | null;
  unit: string;
  costPrice: string;
  sellingPrice: string;
  reorderLevel: number;
  status: string;
  category: { id: string; name: string } | null;
  brand: { id: string; name: string } | null;
  variants: { sku: string; barcode: string | null; size: string | null; color: string | null }[];
  inventory: {
    quantity: number;
    reservedQuantity: number;
    location: { id: string; name: string; code: string };
  }[];
  movements: {
    id: string;
    type: string;
    quantity: number;
    referenceType: string;
    metadata: unknown;
    location: { name: string };
    createdAt: string;
  }[];
}

const TYPE_COLORS: Record<string, "green" | "red" | "amber" | "blue" | "indigo" | "zinc"> = {
  PURCHASE: "green",
  SALE: "red",
  RETURN: "green",
  TRANSFER_IN: "blue",
  TRANSFER_OUT: "amber",
  ADJUSTMENT: "zinc",
  DAMAGE: "red",
  STOCK_COUNT: "indigo",
};

export default function ProductDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const product = useQuery({
    queryKey: ["product", id],
    queryFn: () => apiFetch<ProductDetail>(`/products/${id}`),
  });

  if (product.isLoading) return <Loading />;
  if (product.isError || !product.data) return <Empty label="Product not found" />;

  const p = product.data;
  const totalStock = p.inventory.reduce((s, i) => s + i.quantity, 0);
  const grouped = p.movements.reduce<Record<string, typeof p.movements>>((acc, m) => {
    (acc[m.referenceType] ??= []).push(m);
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Catalog / Product"
        title={p.name}
        description={`SKU ${p.sku} · ${p.brand?.name ?? "No brand"} · ${p.category?.name ?? "No category"}`}
        actions={<><Badge color={p.status === "ACTIVE" ? "green" : "zinc"}>{p.status}</Badge>
          <InventoryAdjustmentAction product={{ id: p.id, name: p.name, sku: p.sku }} />
          <ProductAction product={p} /></>}
      />

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard label="Selling price" value={formatMoney(p.sellingPrice)} />
        <StatCard label="Cost price" value={formatMoney(p.costPrice)} />
        <StatCard label="Total stock" value={formatNumber(totalStock)} />
        <StatCard label="Reorder level" value={formatNumber(p.reorderLevel)} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Current inventory by location</CardTitle>
        </CardHeader>
        <CardContent>
          {p.inventory.length === 0 ? (
            <Empty label="No stock at any location" />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Location</TH>
                  <TH className="text-right">Quantity</TH>
                  <TH className="text-right">Available</TH>
                </TR>
              </THead>
              <TBody>
                {p.inventory.map((i) => (
                  <TR key={i.location.id}>
                    <TD>{i.location.name}</TD>
                    <TD className="text-right">{formatNumber(i.quantity)}</TD>
                    <TD className="text-right">{formatNumber(i.quantity - i.reservedQuantity)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Inventory movements</CardTitle>
        </CardHeader>
        <CardContent>
          {p.movements.length === 0 ? (
            <Empty label="No movements" />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Type</TH>
                  <TH className="text-right">Qty</TH>
                  <TH>Reference</TH>
                  <TH>Location</TH>
                  <TH>Date</TH>
                </TR>
              </THead>
              <TBody>
                {p.movements.map((m) => (
                  <TR key={m.id}>
                    <TD>
                      <Badge color={TYPE_COLORS[m.type] ?? "zinc"}>{m.type}</Badge>
                    </TD>
                    <TD className={`text-right font-medium ${m.quantity > 0 ? "text-emerald-600" : "text-red-600"}`}>
                      {m.quantity > 0 ? "+" : ""}
                      {m.quantity}
                    </TD>
                    <TD className="text-xs text-zinc-500">{m.referenceType}</TD>
                    <TD>{m.location.name}</TD>
                    <TD className="text-xs text-zinc-500">{formatDate(m.createdAt)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {(["Sale", "GoodsReceipt", "StockTransfer", "StockAdjustment", "SaleReturn"] as const).map((ref) => (
          <Card key={ref}>
            <CardHeader>
              <CardTitle>{ref} history</CardTitle>
            </CardHeader>
            <CardContent>
              {grouped[ref] && grouped[ref].length > 0 ? (
                <Table>
                  <THead>
                    <TR>
                      <TH>Type</TH>
                      <TH className="text-right">Qty</TH>
                      <TH>Date</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {grouped[ref].map((m) => (
                      <TR key={m.id}>
                        <TD>
                          <Badge color={TYPE_COLORS[m.type] ?? "zinc"}>{m.type}</Badge>
                        </TD>
                        <TD className={`text-right ${m.quantity > 0 ? "text-emerald-600" : "text-red-600"}`}>
                          {m.quantity > 0 ? "+" : ""}
                          {m.quantity}
                        </TD>
                        <TD className="text-xs text-zinc-500">{formatDate(m.createdAt)}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              ) : (
                <Empty label={`No ${ref.toLowerCase()} records`} />
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
