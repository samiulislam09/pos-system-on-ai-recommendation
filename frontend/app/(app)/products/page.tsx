"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Empty,
  TableSkeleton,
  PageHeader,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
  formatMoney,
  formatNumber,
} from "@/components/ui";
import { ProductAction } from "@/components/management/product-actions";

interface Product {
  id: string;
  sku: string;
  name: string;
  status: string;
  costPrice: string;
  sellingPrice: string;
  reorderLevel: number;
  category: { name: string } | null;
  brand: { name: string } | null;
  inventory: { quantity: number; locationId: string }[];
}

interface Paginated<T> {
  data: T[];
  meta: { page: number; limit: number; total: number; totalPages: number };
}

export default function ProductsPage() {
  const products = useQuery({
    queryKey: ["products"],
    queryFn: () => apiFetch<Paginated<Product>>("/products?page=1&limit=100"),
  });

  const totalStock = (p: Product) => p.inventory.reduce((s, i) => s + i.quantity, 0);

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Catalog" title="Products" description="Manage catalog details, variants, pricing, and stock thresholds." actions={<ProductAction />} />

      <Card>
        <CardHeader>
          <CardTitle>{products.data ? `${products.data.meta.total} products` : "Products"}</CardTitle>
        </CardHeader>
        <CardContent>
          {products.isLoading ? (
            <TableSkeleton />
          ) : products.data && products.data.data.length > 0 ? (
            <Table>
              <THead>
                <TR>
                  <TH>Product</TH>
                  <TH>SKU</TH>
                  <TH className="text-right">Total Stock</TH>
                  <TH className="text-right">Selling Price</TH>
                  <TH className="text-right">Cost Price</TH>
                  <TH>Status</TH>
                </TR>
              </THead>
              <TBody>
                {products.data.data.map((p) => (
                  <TR key={p.id}>
                    <TD>
                      <Link href={`/products/${p.id}`} className="font-semibold text-teal-700 hover:text-teal-900 hover:underline">
                        {p.name}
                      </Link>
                      {(p.brand || p.category) && (
                        <div className="text-xs text-zinc-500">
                          {[p.brand?.name, p.category?.name].filter(Boolean).join(" · ")}
                        </div>
                      )}
                    </TD>
                    <TD className="font-mono text-xs">{p.sku}</TD>
                    <TD className="text-right">{formatNumber(totalStock(p))}</TD>
                    <TD className="text-right">{formatMoney(p.sellingPrice)}</TD>
                    <TD className="text-right">{formatMoney(p.costPrice)}</TD>
                    <TD>
                      <Badge color={p.status === "ACTIVE" ? "green" : "zinc"}>{p.status}</Badge>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          ) : (
            <Empty label="No products yet" hint="Use the New product button above to add your first item." />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
