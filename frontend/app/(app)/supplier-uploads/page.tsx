"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import {
  Badge,
  Button,
  Card,
  CardContent,
  Empty,
  Loading,
  PageHeader,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Input,
} from "@/components/ui";

interface Upload {
  id: string;
  originalName: string;
  status: string;
  rowCount: number;
  submissionCount: number;
  createdAt: string;
  supplierUser: { id: string; name: string; email: string };
  location: { name: string } | null;
  _count: { items: number };
}

interface Counts {
  PENDING: number;
  REJECTED: number;
  ACCEPTED: number;
  INCOMPLETE: number;
}

interface Meta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  counts: Counts;
}

export default function SupplierUploadsPage() {
  const [status, setStatus] = useState<string>("");
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["manage-supplier-uploads", page, status, search],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page), limit: "20" });
      if (status) params.set("status", status);
      if (search) params.set("search", search);
      return apiFetch<{ data: Upload[]; meta: Meta }>(
        `/supplier-portal/manage/uploads?${params}`,
      );
    },
  });

  const counts = data?.meta?.counts;

  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow="Supplier uploads"
        title="Review queue"
        description="Review and act on product uploads submitted by your suppliers."
        actions={
          <Link href="/suppliers">
            <Button variant="outline">Manage supplier accounts</Button>
          </Link>
        }
      />

      {counts && (
        <div className="flex flex-wrap gap-2">
          {(["", "PENDING", "INCOMPLETE", "REJECTED", "ACCEPTED"] as const).map((s) => (
            <button
              key={s || "ALL"}
              onClick={() => { setStatus(s); setPage(1); }}
              className={`rounded-lg border px-3 py-2 text-xs font-semibold transition-all ${
                status === s
                  ? "border-teal-300 bg-teal-50 text-teal-800"
                  : "border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300 hover:bg-zinc-50"
              }`}
            >
              {s || "All"}{" "}
              {s && counts[s] !== undefined && <span className="ml-1 text-[10px]">({counts[s]})</span>}
              {!s && <span className="ml-1 text-[10px]">({Object.values(counts).reduce((a, b) => a + (b as number), 0)})</span>}
            </button>
          ))}
        </div>
      )}

      <Card>
        <div className="border-b border-zinc-100 px-5 pt-4">
          <Input
            placeholder="Search by supplier name..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="max-w-sm"
          />
        </div>
        <CardContent className="pt-4">
          {isLoading ? (
            <Loading />
          ) : data && data.data.length > 0 ? (
            <Table>
              <THead>
                <TR>
                  <TH>File</TH>
                  <TH>Supplier</TH>
                  <TH>Status</TH>
                  <TH>Rows</TH>
                  <TH>Attempt</TH>
                  <TH>Location</TH>
                  <TH className="text-right">Submitted</TH>
                  <TH className="text-right"></TH>
                </TR>
              </THead>
              <TBody>
                {data.data.map((u) => (
                  <TR key={u.id}>
                    <TD className="font-medium">{u.originalName}</TD>
                    <TD>
                      <div className="text-sm">{u.supplierUser.name}</div>
                      <div className="text-[11px] text-zinc-400">{u.supplierUser.email}</div>
                    </TD>
                    <TD>
                      <Badge color={statusColor(u.status)}>{u.status}</Badge>
                    </TD>
                    <TD>{u.rowCount}</TD>
                    <TD>{u.submissionCount}</TD>
                    <TD>{u.location?.name ?? "—"}</TD>
                    <TD className="text-right text-zinc-500">{new Date(u.createdAt).toLocaleDateString()}</TD>
                    <TD className="text-right">
                      <Link href={`/supplier-uploads/${u.id}`} className="inline-flex items-center gap-1 text-sm font-semibold text-teal-700 hover:underline">
                        {u.status === "PENDING" ? "Review" : "View"} →
                      </Link>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          ) : (
            <Empty label="No uploads found" hint="There are no supplier uploads to review." />
          )}

          {data && data.meta.totalPages > 1 && (
            <div className="mt-4 flex items-center justify-between text-xs text-zinc-500">
              <span>Page {data.meta.page} of {data.meta.totalPages} · {data.meta.total} uploads</span>
              <div className="flex gap-1">
                <Button variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
                <Button variant="outline" disabled={page >= data.meta.totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function statusColor(status: string) {
  if (status === "ACCEPTED") return "green";
  if (status === "REJECTED") return "red";
  if (status === "INCOMPLETE") return "amber";
  return "indigo";
}