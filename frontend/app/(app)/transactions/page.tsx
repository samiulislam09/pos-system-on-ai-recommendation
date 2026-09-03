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
  PageHeader,
  Select,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
  formatDate,
  formatMoney,
} from "@/components/ui";

interface TransactionEvent {
  id: string;
  eventId: string;
  type: string;
  status: string;
  createdAt: string;
}

interface TransactionDocument {
  transactionNumber?: string;
  returnNumber?: string;
  total?: string;
  status: string;
  store?: { name: string } | null;
}

interface TransactionRow {
  event: TransactionEvent;
  transaction: TransactionDocument | null;
}

interface Paginated<T> {
  data: T[];
  meta: { page: number; limit: number; total: number; totalPages: number };
}

const TYPE_COLORS: Record<string, "green" | "red" | "amber" | "blue" | "indigo" | "zinc"> = {
  SALE: "green",
  SALE_ITEM: "green",
  RETURN: "amber",
  PURCHASE: "blue",
  GOODS_RECEIPT: "blue",
  TRANSFER_OUT: "indigo",
  TRANSFER_IN: "indigo",
  ADJUSTMENT: "zinc",
};

const STATUS_COLORS: Record<string, "green" | "red" | "amber" | "blue" | "zinc"> = {
  PROCESSED: "green",
  COMPLETED: "green",
  PAID: "green",
  FAILED: "red",
  INSUFFICIENT_STOCK: "red",
  PENDING: "amber",
  IN_TRANSIT: "amber",
  DUPLICATE: "zinc",
  REQUESTED: "amber",
  APPROVED: "blue",
  REJECTED: "red",
  RECEIVED: "green",
};

export default function TransactionsPage() {
  const [type, setType] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);

  const transactions = useQuery({
    queryKey: ["transactions", type, status, page],
    queryFn: () =>
      apiFetch<Paginated<TransactionRow>>(
        `/transactions?page=${page}&limit=20${type ? `&type=${type}` : ""}${status ? `&status=${status}` : ""}`,
      ),
  });

  const { data } = transactions;
  const meta = data?.meta;

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Ledger" title="Transactions" description="Trace sales and returns from ingestion through final processing." />

      <Card>
        <CardContent className="pt-5">
          <div className="flex flex-wrap gap-3">
            <Select value={type} onChange={(e) => { setType(e.target.value); setPage(1); }} className="max-w-xs">
              <option value="">All types</option>
              {["SALE", "RETURN"].map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </Select>
            <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="max-w-xs">
              <option value="">All statuses</option>
              {["RECEIVED", "PROCESSED", "FAILED"].map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{meta ? `${meta.total} transactions` : "Transactions"}</CardTitle>
        </CardHeader>
        <CardContent>
          {transactions.isLoading ? (
            <Loading />
          ) : transactions.isError ? (
            <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">Transactions could not be loaded. Check the API connection and try again.</p>
          ) : data && data.data.length > 0 ? (
            <Table>
              <THead>
                <TR>
                  <TH>Type</TH>
                  <TH>Status</TH>
                  <TH>Reference</TH>
                  <TH>Location</TH>
                  <TH className="text-right">Amount / Qty</TH>
                  <TH>Date</TH>
                </TR>
              </THead>
              <TBody>
                {data.data.map(({ event, transaction }) => (
                  <TR key={event.id}>
                    <TD><Badge color={TYPE_COLORS[event.type] ?? "zinc"}>{event.type}</Badge></TD>
                    <TD><Badge color={STATUS_COLORS[event.status] ?? "zinc"}>{event.status}</Badge></TD>
                    <TD className="font-mono text-xs">{transaction?.transactionNumber ?? transaction?.returnNumber ?? event.eventId}</TD>
                    <TD>{transaction?.store?.name ?? "—"}</TD>
                    <TD className="text-right">
                      {transaction?.total !== undefined ? formatMoney(transaction.total) : "—"}
                    </TD>
                    <TD className="text-xs text-zinc-500">{formatDate(event.createdAt)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          ) : (
            <Empty label="No transactions" />
          )}

          {meta && meta.totalPages > 1 ? (
            <div className="mt-4 flex items-center justify-between">
              <span className="text-sm text-zinc-500">
                Page {meta.page} of {meta.totalPages}
              </span>
              <div className="flex gap-2">
                <button
                  className="min-h-9 rounded-lg border border-zinc-300 bg-white px-3 text-sm font-medium disabled:opacity-40"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  Prev
                </button>
                <button
                  className="min-h-9 rounded-lg border border-zinc-300 bg-white px-3 text-sm font-medium disabled:opacity-40"
                  disabled={page >= (meta.totalPages ?? 1)}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                </button>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
