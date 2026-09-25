"use client";

import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { Badge, Button, Card, CardContent, Empty, Loading, PageHeader } from "@/components/ui";

type VendorNotificationType = "UPLOAD_SUBMITTED" | "UPLOAD_RESUBMITTED" | "ROWS_RESUBMITTED";

interface VendorNotification {
  id: string;
  type: VendorNotificationType;
  message: string;
  createdAt: string;
  readAt: string | null;
  upload: { id: string; originalName: string; status: string; supplierUser: { name: string } };
}

const TYPE_LABELS: Record<VendorNotificationType, string> = {
  UPLOAD_SUBMITTED: "New upload",
  UPLOAD_RESUBMITTED: "Resubmitted file",
  ROWS_RESUBMITTED: "Corrected rows",
};
const TYPE_COLORS: Record<VendorNotificationType, "indigo" | "blue" | "amber"> = {
  UPLOAD_SUBMITTED: "indigo",
  UPLOAD_RESUBMITTED: "blue",
  ROWS_RESUBMITTED: "amber",
};

export default function VendorNotificationsPage() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["vendor-notifications"],
    queryFn: () => apiFetch<{ data: VendorNotification[]; unread: number }>("/notifications"),
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["vendor-notifications"] });
  const markRead = useMutation({
    mutationFn: (id: string) => apiFetch(`/notifications/${id}/read`, { method: "POST" }),
    onSuccess: refresh,
  });
  const markAllRead = useMutation({
    mutationFn: () => apiFetch("/notifications/read-all", { method: "POST" }),
    onSuccess: refresh,
  });

  const notifications = data?.data ?? [];

  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow="Notifications"
        title="Supplier activity"
        description="Uploads and corrections suppliers have sent for your review. New ones appear here as they arrive."
        actions={
          data ? (
            <div className="flex items-center gap-3">
              {data.unread > 0 ? <Badge color="blue">{data.unread} unread</Badge> : <Badge color="zinc">All read</Badge>}
              {data.unread > 0 && (
                <Button variant="secondary" onClick={() => markAllRead.mutate()} disabled={markAllRead.isPending}>
                  Mark all as read
                </Button>
              )}
            </div>
          ) : null
        }
      />

      <Card>
        <CardContent className="pt-6">
          {isLoading ? (
            <Loading />
          ) : notifications.length === 0 ? (
            <Empty label="No notifications yet" hint="You'll be notified when a supplier submits an upload for review" />
          ) : (
            <div className="space-y-3">
              {notifications.map((n) => (
                <Link
                  key={n.id}
                  href={`/supplier-uploads/${n.upload.id}`}
                  onClick={() => !n.readAt && markRead.mutate(n.id)}
                  className={`block rounded-xl border p-5 transition-all hover:shadow-md ${
                    n.readAt ? "border-zinc-200 bg-white" : "border-teal-200 bg-teal-50/50"
                  }`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    {!n.readAt && <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-teal-500" />}
                    <Badge color={TYPE_COLORS[n.type]}>{TYPE_LABELS[n.type]}</Badge>
                    <span className="text-xs text-zinc-400">{new Date(n.createdAt).toLocaleString()}</span>
                    <span className="ml-auto text-[11px] font-medium text-zinc-500">
                      {n.upload.supplierUser.name} · {n.upload.originalName}
                    </span>
                  </div>
                  <p className="mt-3 text-sm leading-6 text-zinc-700">{n.message}</p>
                  <span className="mt-3 inline-flex text-xs font-semibold text-teal-700">Review upload →</span>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
