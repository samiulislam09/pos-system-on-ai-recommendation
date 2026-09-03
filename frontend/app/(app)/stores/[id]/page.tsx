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
import { AddTerminalAction, LocationAction, TerminalStatusAction } from "@/components/management/location-actions";
import { SalesCsvButton } from "@/components/management/sales-export";

interface StoreDetail {
  id: string;
  name: string;
  code: string;
  type: "STORE" | "WAREHOUSE";
  address: string | null;
  status: string;
  postTerminals: { id: string; terminalCode: string; status: string }[];
  inventory: {
    productId: string;
    quantity: number;
    reservedQuantity: number;
    product: { sku: string; name: string; sellingPrice: string; reorderLevel: number };
  }[];
  sales: {
    id: string;
    transactionNumber: string;
    total: string;
    discount: string;
    paymentStatus: string;
    terminal: { terminalCode: string } | null;
    createdAt: string;
  }[];
  transfersIn: {
    id: string;
    transferNumber: string;
    status: string;
    source: { name: string };
    createdAt: string;
  }[];
  transfersOut: {
    id: string;
    transferNumber: string;
    status: string;
    destination: { name: string };
    createdAt: string;
  }[];
  pendingTransfersIn: number;
}

export default function StoreDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const store = useQuery({
    queryKey: ["store", id],
    queryFn: () => apiFetch<StoreDetail>(`/stores/${id}`),
  });

  if (store.isLoading) return <Loading />;
  if (store.isError || !store.data) return <Empty label="Store not found" />;

  const s = store.data;
  const stockValue = s.inventory.reduce(
    (acc, i) => acc + i.quantity * parseFloat(i.product.sellingPrice),
    0,
  );
  const lowStock = s.inventory.filter((i) => i.quantity > 0 && i.quantity <= i.product.reorderLevel);
  const outOfStock = s.inventory.filter((i) => i.quantity <= 0);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Network / Location"
        title={s.name}
        description={`${s.code} · ${s.type} · ${s.address ?? "No address"}`}
        actions={<><Badge color={s.status === "ACTIVE" ? "green" : "zinc"}>{s.status}</Badge><LocationAction location={s} /></>}
      />

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard label="Stock value" value={formatMoney(stockValue)} />
        <StatCard label="Low stock" value={formatNumber(lowStock.length)} />
        <StatCard label="Out of stock" value={formatNumber(outOfStock.length)} />
        <StatCard label="Pending transfers in" value={formatNumber(s.pendingTransfersIn)} />
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <CardTitle>POS terminals</CardTitle>
          {s.type === "STORE" ? <AddTerminalAction storeId={s.id} /> : null}
        </CardHeader>
        <CardContent>
          {s.postTerminals.length === 0 ? (
            <Empty label="No terminals" />
          ) : (
            <Table>
              <THead>
                  <TR>
                    <TH>Name</TH>
                    <TH>Status</TH>
                    <TH className="text-right">Action</TH>
                </TR>
              </THead>
              <TBody>
                {s.postTerminals.map((t) => (
                  <TR key={t.id}>
                    <TD>{t.terminalCode}</TD>
                    <TD>
                      <Badge color={t.status === "ACTIVE" ? "green" : "zinc"}>{t.status}</Badge>
                    </TD>
                    <TD className="text-right"><TerminalStatusAction storeId={s.id} terminal={t} /></TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
          <CardTitle>Recent sales</CardTitle>
          <SalesCsvButton storeId={s.id} storeCode={s.code} />
        </CardHeader>
        <CardContent>
          {s.sales.length === 0 ? (
            <Empty label="No sales yet" />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Invoice</TH>
                  <TH>Terminal</TH>
                  <TH className="text-right">Total</TH>
                  <TH>Payment</TH>
                  <TH>Date</TH>
                </TR>
              </THead>
              <TBody>
                {s.sales.map((sale) => (
                  <TR key={sale.id}>
                    <TD className="font-mono text-xs">{sale.transactionNumber}</TD>
                    <TD>{sale.terminal?.terminalCode ?? "—"}</TD>
                    <TD className="text-right">{formatMoney(sale.total)}</TD>
                    <TD>
                      <Badge color={sale.paymentStatus === "PAID" ? "green" : "amber"}>{sale.paymentStatus}</Badge>
                    </TD>
                    <TD className="text-xs text-zinc-500">{formatDate(sale.createdAt)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Transfers in</CardTitle>
          </CardHeader>
          <CardContent>
            {s.transfersIn.length === 0 ? (
              <Empty label="No inbound transfers" />
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>Transfer</TH>
                    <TH>Source</TH>
                    <TH>Status</TH>
                    <TH>Date</TH>
                  </TR>
                </THead>
                <TBody>
                  {s.transfersIn.map((t) => (
                    <TR key={t.id}>
                      <TD className="font-mono text-xs">{t.transferNumber}</TD>
                      <TD>{t.source.name}</TD>
                      <TD>
                        <Badge color={t.status === "RECEIVED" ? "green" : "amber"}>{t.status}</Badge>
                      </TD>
                      <TD className="text-xs text-zinc-500">{formatDate(t.createdAt)}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Transfers out</CardTitle>
          </CardHeader>
          <CardContent>
            {s.transfersOut.length === 0 ? (
              <Empty label="No outbound transfers" />
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>Transfer</TH>
                    <TH>Destination</TH>
                    <TH>Status</TH>
                    <TH>Date</TH>
                  </TR>
                </THead>
                <TBody>
                  {s.transfersOut.map((t) => (
                    <TR key={t.id}>
                      <TD className="font-mono text-xs">{t.transferNumber}</TD>
                      <TD>{t.destination.name}</TD>
                      <TD>
                        <Badge color={t.status === "RECEIVED" ? "green" : "amber"}>{t.status}</Badge>
                      </TD>
                      <TD className="text-xs text-zinc-500">{formatDate(t.createdAt)}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
