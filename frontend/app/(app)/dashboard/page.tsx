"use client";

import Link from "next/link";
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
  PageHeader,
  StatCard,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
  formatMoney,
} from "@/components/ui";
import { SalesBarChart } from "@/components/sales-chart";

interface Overview {
  todaySales: number;
  todayTransactions: number;
  todayEvents: number;
  totalInventoryValue: number;
  totalUnits: number;
  lowStock: number;
  outOfStock: number;
  activeStores: number;
  pendingTransfers: number;
  failedEvents: number;
}

interface SalesByDay {
  day: string;
  total: number;
  transactions: number;
}

interface TopProduct {
  productId: string;
  sku: string;
  name: string;
  quantity: number;
  revenue: number;
}

export default function DashboardPage() {
  const overview = useQuery({ queryKey: ["overview"], queryFn: () => apiFetch<Overview>("/reports/overview") });
  const sales = useQuery({
    queryKey: ["sales-14d"],
    queryFn: () => apiFetch<SalesByDay[]>("/reports/sales"),
  });
  const topProducts = useQuery({
    queryKey: ["top-products"],
    queryFn: () => apiFetch<TopProduct[]>("/reports/top-products"),
  });

  const [yesterdayKey] = useState(() => new Date(Date.now() - 86_400_000).toISOString().slice(0, 10));
  const byDay = new Map(sales.data?.map((d) => [d.day.slice(0, 10), d]) ?? []);
  const yesterday = byDay.get(yesterdayKey);

  return (
    <div className="space-y-7">
      <PageHeader eyebrow="Workspace" title="Operations overview" description="A live view of sales, inventory health, and activity across every location." actions={<Badge color="green">Live data</Badge>} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Today's Sales"
          value={overview.data ? formatMoney(overview.data.todaySales) : "—"}
          hint={
            <>
              {overview.data?.todayTransactions ?? 0} transactions
              {overview.data && yesterday ? (
                <>
                  {" · "}
                  <TrendDelta today={overview.data.todaySales} previous={yesterday.total} />
                </>
              ) : null}
            </>
          }
        />
        <StatCard label="Inventory Value" value={overview.data ? formatMoney(overview.data.totalInventoryValue) : "—"} hint={`${overview.data?.totalUnits ?? 0} units`} />
        <StatCard label="Active Stores" value={overview.data?.activeStores ?? "—"} />
        <StatCard label="Low Stock" value={overview.data?.lowStock ?? "—"} hint={`${overview.data?.outOfStock ?? 0} out of stock`} />
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1.15fr_0.85fr]">
        <Card>
          <CardHeader>
            <CardTitle>Sales, last 30 days</CardTitle>
            <p className="mt-1 text-xs text-zinc-500">Daily completed transaction value</p>
          </CardHeader>
          <CardContent>
            {sales.isLoading ? (
              <Loading />
            ) : sales.data && sales.data.length > 0 ? (
              <SalesBarChart data={sales.data} />
            ) : (
              <Empty label="No sales yet" />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Top products</CardTitle>
            <p className="mt-1 text-xs text-zinc-500">Ranked by revenue in the current period</p>
          </CardHeader>
          <CardContent>
            {topProducts.isLoading ? (
              <Loading />
            ) : topProducts.data && topProducts.data.length > 0 ? (
              <Table>
                <THead>
                  <TR>
                    <TH>Product</TH>
                    <TH className="text-right">Qty</TH>
                    <TH className="text-right">Revenue</TH>
                  </TR>
                </THead>
                <TBody>
                  {topProducts.data.map((p) => (
                    <TR key={p.productId}>
                      <TD>
                        <div className="font-medium">{p.name}</div>
                        <div className="text-xs text-zinc-500">{p.sku}</div>
                      </TD>
                      <TD className="text-right">{p.quantity}</TD>
                      <TD className="text-right">{formatMoney(p.revenue)}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            ) : (
              <Empty label="No products sold" />
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Attention required</CardTitle>
          <p className="mt-1 text-xs text-zinc-500">Operational exceptions that may need follow-up</p>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            <AlertChip active={overview.data && overview.data.lowStock > 0} label={`${overview.data?.lowStock ?? 0} low stock`} color="amber" href="/inventory?stockStatus=LOW_STOCK" />
            <AlertChip active={overview.data && overview.data.outOfStock > 0} label={`${overview.data?.outOfStock ?? 0} out of stock`} color="red" href="/inventory?stockStatus=OUT_OF_STOCK" />
            <AlertChip active={overview.data && overview.data.pendingTransfers > 0} label={`${overview.data?.pendingTransfers ?? 0} pending transfers`} color="blue" />
            <AlertChip active={overview.data && overview.data.failedEvents > 0} label={`${overview.data?.failedEvents ?? 0} failed events`} color="red" href="/transactions?status=FAILED" />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function TrendDelta({ today, previous }: { today: number; previous: number }) {
  if (previous <= 0) {
    return <span className="text-zinc-500">vs {formatMoney(previous)} yesterday</span>;
  }
  const pct = ((today - previous) / previous) * 100;
  if (Math.abs(pct) < 0.5) {
    return <span className="text-zinc-500">flat vs yesterday</span>;
  }
  const up = pct > 0;
  return (
    <span className={up ? "font-medium text-emerald-600" : "font-medium text-red-600"}>
      {up ? "▲" : "▼"} {Math.abs(pct).toFixed(0)}% vs yesterday
    </span>
  );
}

function AlertChip({ active, label, color, href }: { active: boolean | undefined; label: string; color: "amber" | "red" | "blue"; href?: string }) {
  const tones = {
    amber: "border-amber-200 bg-amber-50 text-amber-800",
    red: "border-red-200 bg-red-50 text-red-800",
    blue: "border-sky-200 bg-sky-50 text-sky-800",
  };
  const className = `flex items-center gap-2 rounded-lg border px-3 py-2.5 text-xs font-semibold ${active ? tones[color] : "border-zinc-200 bg-zinc-50 text-zinc-500"}`;
  const content = (
    <>
      <span className={`h-1.5 w-1.5 rounded-full ${active ? color === "red" ? "bg-red-500" : color === "amber" ? "bg-amber-500" : "bg-sky-500" : "bg-zinc-300"}`} />
      {label}
    </>
  );
  if (href && active) {
    return (
      <Link href={href} className={`${className} transition-shadow hover:shadow-sm hover:underline`}>
        {content}
      </Link>
    );
  }
  return <div className={className}>{content}</div>;
}

