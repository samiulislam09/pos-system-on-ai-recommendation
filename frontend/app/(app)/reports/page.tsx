"use client";

import { useState } from "react";
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
  Input,
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
import { SalesBarChart } from "@/components/sales-chart";

interface SalesByDay {
  day: string;
  total: string;
  transactions: number;
}

interface StoreSales {
  storeId: string;
  name: string;
  transactions: number;
  total: number;
}

interface TopProduct {
  productId: string;
  sku: string;
  name: string;
  quantity: number;
  revenue: string;
}

interface Movement {
  id: string;
  type: string;
  quantity: number;
  referenceType: string;
  product: { sku: string; name: string };
  location: { name: string };
  createdAt: string;
}

interface MovementReport {
  movements: Movement[];
  summary: Array<{ type: string; _sum: { quantity: number | null } }>;
}

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

export default function ReportsPage() {
  const [from, setFrom] = useState(daysAgo(30));
  const [to, setTo] = useState(daysAgo(0));
  const validRange = Boolean(from && to && from <= to);
  const range = validRange
    ? new URLSearchParams({
        from: new Date(`${from}T00:00:00.000Z`).toISOString(),
        to: new Date(`${to}T23:59:59.999Z`).toISOString(),
      }).toString()
    : "";

  const sales = useQuery({ queryKey: ["r-sales", from, to], queryFn: () => apiFetch<SalesByDay[]>(`/reports/sales?${range}`), enabled: validRange });
  const stores = useQuery({ queryKey: ["r-stores", from, to], queryFn: () => apiFetch<StoreSales[]>(`/reports/stores?${range}`), enabled: validRange });
  const top = useQuery({ queryKey: ["r-top", from, to], queryFn: () => apiFetch<TopProduct[]>(`/reports/top-products?${range}&limit=10`), enabled: validRange });
  const movements = useQuery({ queryKey: ["r-movements", from, to], queryFn: () => apiFetch<MovementReport>(`/reports/movements?${range}`), enabled: validRange });

  const totalRevenue = sales.data?.reduce((s, d) => s + parseFloat(d.total), 0) ?? 0;
  const totalTransactions = sales.data?.reduce((s, d) => s + d.transactions, 0) ?? 0;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Analytics"
        title="Reports"
        description="Sales performance and stock movement across your selected period."
      />

      <Card>
        <CardContent className="pt-5">
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <label htmlFor="report-from" className="mb-1 block text-xs font-medium text-zinc-500">From</label>
              <Input id="report-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-auto" />
            </div>
            <div>
              <label htmlFor="report-to" className="mb-1 block text-xs font-medium text-zinc-500">To</label>
              <Input id="report-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-auto" />
            </div>
          </div>
        </CardContent>
      </Card>

      {!validRange ? <p role="alert" className="text-sm text-red-600">The start date must not be after the end date.</p> : null}
      {[sales, stores, top, movements].some((query) => query.isError) ? (
        <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">Some report data could not be loaded. Check the API connection and try again.</p>
      ) : null}

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard label="Total revenue" value={formatMoney(totalRevenue)} />
        <StatCard label="Transactions" value={formatNumber(totalTransactions)} />
        <StatCard label="Top product" value={top.data?.[0]?.name ?? "—"} />
        <StatCard label="Movements" value={formatNumber(movements.data?.movements.length ?? 0)} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Sales per day</CardTitle></CardHeader>
          <CardContent>
            {sales.isLoading ? <Loading /> : sales.data && sales.data.length ? <SalesBarChart data={sales.data} /> : <Empty />}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Sales per store</CardTitle></CardHeader>
          <CardContent>
            {stores.isLoading ? <Loading /> : stores.data && stores.data.length ? (
              <Table>
                <THead>
                  <TR>
                    <TH>Store</TH>
                    <TH className="text-right">Txns</TH>
                    <TH className="text-right">Total</TH>
                  </TR>
                </THead>
                <TBody>
                  {stores.data.map((s) => (
                    <TR key={s.storeId}>
                      <TD>{s.name}</TD>
                      <TD className="text-right">{s.transactions}</TD>
                      <TD className="text-right font-medium">{formatMoney(s.total)}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            ) : <Empty />}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Top products</CardTitle></CardHeader>
        <CardContent>
          {top.isLoading ? <Loading /> : top.data && top.data.length ? (
            <Table>
              <THead>
                <TR>
                  <TH>Product</TH>
                  <TH>SKU</TH>
                  <TH className="text-right">Qty sold</TH>
                  <TH className="text-right">Revenue</TH>
                </TR>
              </THead>
              <TBody>
                {top.data.map((p, i) => (
                  <TR key={p.productId}>
                    <TD><Badge color="indigo">#{i + 1}</Badge> {p.name}</TD>
                    <TD className="font-mono text-xs">{p.sku}</TD>
                    <TD className="text-right">{p.quantity}</TD>
                    <TD className="text-right font-medium">{formatMoney(p.revenue)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          ) : <Empty />}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Inventory movements</CardTitle></CardHeader>
        <CardContent>
          {movements.isLoading ? <Loading /> : movements.data && movements.data.movements.length ? (
            <Table>
              <THead>
                <TR>
                  <TH>Type</TH>
                  <TH>Product</TH>
                  <TH className="text-right">Qty</TH>
                  <TH>Reference</TH>
                  <TH>Location</TH>
                  <TH>Date</TH>
                </TR>
              </THead>
              <TBody>
                {movements.data.movements.map((m) => (
                  <TR key={m.id}>
                    <TD><Badge color={m.quantity > 0 ? "green" : "red"}>{m.type}</Badge></TD>
                    <TD>{m.product.name}</TD>
                    <TD className={`text-right ${m.quantity > 0 ? "text-emerald-600" : "text-red-600"}`}>{m.quantity > 0 ? "+" : ""}{m.quantity}</TD>
                    <TD className="text-xs text-zinc-500">{m.referenceType}</TD>
                    <TD>{m.location.name}</TD>
                    <TD className="text-xs text-zinc-500">{formatDate(m.createdAt)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          ) : <Empty />}
        </CardContent>
      </Card>
    </div>
  );
}

