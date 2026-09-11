"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { supplierApiFetch } from "@/lib/supplier-api";
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Empty,
  Loading,
  PageHeader,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from "@/components/ui";

interface SupplierProfile {
  user: { id: string; name: string; email: string };
  company: { name: string; phone: string | null; address: string | null } | null;
  report: {
    totalUploads: number;
    unreadNotifications: number;
    counts: Record<string, number>;
  };
}

interface UploadItem {
  id: string;
  originalName: string;
  status: string;
  rowCount: number;
  createdAt: string;
  vendorNote: string | null;
  _count: { items: number };
}

export default function SupplierDashboardPage() {
  const profile = useQuery({
    queryKey: ["supplier-profile"],
    queryFn: () => supplierApiFetch<SupplierProfile>("/supplier-portal/me"),
  });

  const uploads = useQuery({
    queryKey: ["supplier-uploads", 1, 5],
    queryFn: () =>
      supplierApiFetch<{ data: UploadItem[]; meta: { total: number } }>(
        "/supplier-portal/uploads?page=1&limit=5",
      ),
  });

  const notifications = useQuery({
    queryKey: ["supplier-notifications"],
    queryFn: () =>
      supplierApiFetch<{
        data: Array<{
          id: string;
          type: string;
          message: string;
          createdAt: string;
          readAt: string | null;
          upload: { id: string; originalName: string; status: string; vendorNote: string | null };
        }>;
        unread: number;
      }>("/supplier-portal/notifications"),
  });

  useEffect(() => {
    if (notifications.data) {
      localStorage.setItem("sup_unread", String(notifications.data.unread));
      window.dispatchEvent(new Event("supplier-auth-changed"));
    }
  }, [notifications.data]);

  const report = profile.data?.report;
  const pending = report?.counts?.PENDING ?? 0;
  const rejected = report?.counts?.REJECTED ?? 0;
  const accepted = report?.counts?.ACCEPTED ?? 0;
  const incomplete = report?.counts?.INCOMPLETE ?? 0;

  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow="Supplier workspace"
        title="Overview"
        description="Track your product uploads and vendor feedback."
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard label="Total uploads" value={report?.totalUploads ?? "—"} />
        <StatCard label="Pending review" value={pending} hint="awaiting vendor action" />
        <StatCard label="Needs fixing" value={incomplete} hint="missing data" color="amber" />
        <StatCard label="Rejected" value={rejected} hint="requires resubmission" color="red" />
        <StatCard label="Accepted" value={accepted} hint="added to stock" color="green" />
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1.15fr_0.85fr]">
        <Card>
          <CardHeader>
            <CardTitle>Recent uploads</CardTitle>
            <p className="mt-1 text-xs text-zinc-500">Your latest product submissions</p>
          </CardHeader>
          <CardContent>
            {uploads.isLoading ? (
              <Loading />
            ) : uploads.data && uploads.data.data.length > 0 ? (
              <Table>
                <THead>
                  <TR>
                    <TH>File</TH>
                    <TH>Status</TH>
                    <TH className="text-right">Rows</TH>
                    <TH className="text-right">Date</TH>
                  </TR>
                </THead>
                <TBody>
                  {uploads.data.data.map((u) => (
                    <TR key={u.id}>
                      <TD>
                        <Link href={`/supplier/uploads/${u.id}`} className="font-medium text-teal-700 hover:underline">
                          {u.originalName}
                        </Link>
                      </TD>
                      <TD>
                        <Badge color={statusColor(u.status)}>{u.status}</Badge>
                      </TD>
                      <TD className="text-right">{u.rowCount}</TD>
                      <TD className="text-right text-zinc-500">{new Date(u.createdAt).toLocaleDateString()}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            ) : (
              <Empty label="No uploads yet" hint="Upload a product file to get started" />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Notifications</CardTitle>
            <p className="mt-1 text-xs text-zinc-500">Vendor feedback on your uploads</p>
          </CardHeader>
          <CardContent>
            {notifications.isLoading ? (
              <Loading />
            ) : notifications.data && notifications.data.data.length > 0 ? (
              <div className="space-y-2">
                {notifications.data.data.slice(0, 6).map((n) => (
                  <Link
                    key={n.id}
                    href={n.upload.status === "INCOMPLETE" ? `/supplier/uploads/${n.upload.id}/fix` : `/supplier/uploads/${n.upload.id}`}
                    className={`block rounded-lg border p-3 text-sm transition-all hover:shadow-sm ${
                      n.readAt ? "border-zinc-200 bg-white" : "border-teal-200 bg-teal-50/50"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className={`h-2 w-2 shrink-0 rounded-full ${n.readAt ? "bg-zinc-300" : "bg-teal-500"}`} />
                      <Badge color={n.type === "REJECTED" ? "red" : n.type === "ACCEPTED" ? "green" : n.upload.status === "INCOMPLETE" ? "amber" : "indigo"}>
                        {n.upload.status === "INCOMPLETE" ? "NEEDS FIXING" : n.type}
                      </Badge>
                    </div>
                    <p className="mt-2 text-xs leading-5 text-zinc-600">{n.message}</p>
                    <p className="mt-1 text-[11px] text-zinc-400">{n.upload.originalName}</p>
                  </Link>
                ))}
              </div>
            ) : (
              <Empty label="No notifications yet" />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function statusColor(status: string) {
  if (status === "ACCEPTED") return "green";
  if (status === "REJECTED") return "red";
  return "amber";
}

function StatCard({
  label,
  value,
  hint,
  color,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  color?: "green" | "red" | "amber";
}) {
  return (
    <Card className="relative overflow-hidden">
      <div
        className={`absolute inset-x-0 top-0 h-0.5 ${
          color === "green"
            ? "bg-gradient-to-r from-emerald-600 via-emerald-400 to-transparent"
            : color === "red"
            ? "bg-gradient-to-r from-red-600 via-red-400 to-transparent"
            : color === "amber"
            ? "bg-gradient-to-r from-amber-600 via-amber-400 to-transparent"
            : "bg-gradient-to-r from-teal-600 via-teal-400 to-transparent"
        }`}
      />
      <CardHeader className="pb-2">
        <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-zinc-500">{label}</p>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-semibold tracking-[-0.04em] text-zinc-950">{value}</div>
        {hint ? <p className="mt-1 text-xs text-zinc-500">{hint}</p> : null}
      </CardContent>
    </Card>
  );
}