"use client";

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

  return (
    <div className="space-y-7">
      <PageHeader eyebrow="Workspace" title="Operations overview" description="A live view of sales, inventory health, and activity across every location." actions={<Badge color="green">Live data</Badge>} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Today's Sales" value={overview.data ? formatMoney(overview.data.todaySales) : "—"} hint={`${overview.data?.todayTransactions ?? 0} transactions`} />
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
            <AlertChip active={overview.data && overview.data.lowStock > 0} label={`${overview.data?.lowStock ?? 0} low stock`} color="amber" />
            <AlertChip active={overview.data && overview.data.outOfStock > 0} label={`${overview.data?.outOfStock ?? 0} out of stock`} color="red" />
            <AlertChip active={overview.data && overview.data.pendingTransfers > 0} label={`${overview.data?.pendingTransfers ?? 0} pending transfers`} color="blue" />
            <AlertChip active={overview.data && overview.data.failedEvents > 0} label={`${overview.data?.failedEvents ?? 0} failed events`} color="red" />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function AlertChip({ active, label, color }: { active: boolean | undefined; label: string; color: "amber" | "red" | "blue" }) {
  const tones = {
    amber: "border-amber-200 bg-amber-50 text-amber-800",
    red: "border-red-200 bg-red-50 text-red-800",
    blue: "border-sky-200 bg-sky-50 text-sky-800",
  };
  return (
    <div className={`flex items-center gap-2 rounded-lg border px-3 py-2.5 text-xs font-semibold ${active ? tones[color] : "border-zinc-200 bg-zinc-50 text-zinc-500"}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${active ? color === "red" ? "bg-red-500" : color === "amber" ? "bg-amber-500" : "bg-sky-500" : "bg-zinc-300"}`} />
      {label}
    </div>
  );
}

function SalesBarChart({ data }: { data: SalesByDay[] }) {
  const max = Math.max(...data.map((d) => d.total), 1);
  return (
    <div className="flex h-40 items-end gap-1">
      {data.map((d) => (
        <div key={d.day} className="group relative flex h-full flex-1 items-end">
          <div
            className="w-full rounded-t-sm bg-teal-600 transition-colors group-hover:bg-teal-700"
            style={{ height: `${Math.max((d.total / max) * 100, 2)}%` }}
            title={`${d.day}: ${formatMoney(d.total)}`}
          />
        </div>
      ))}
    </div>
  );
}
