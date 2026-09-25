"use client";

import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supplierApiFetch } from "@/lib/supplier-api";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Empty,
  Loading,
  PageHeader,
} from "@/components/ui";

interface Notification {
  id: string;
  type: string;
  message: string;
  createdAt: string;
  readAt: string | null;
  upload: {
    id: string;
    originalName: string;
    status: string;
    vendorNote: string | null;
  };
}

export default function SupplierNotificationsPage() {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["supplier-notifications"],
    queryFn: () =>
      supplierApiFetch<{ data: Notification[]; unread: number }>(
        "/supplier-portal/notifications",
      ),
  });

  const markRead = useMutation({
    mutationFn: (notificationId: string) =>
      supplierApiFetch(`/supplier-portal/notifications/${notificationId}/read`, {
        method: "POST",
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["supplier-notifications"] });
      queryClient.invalidateQueries({ queryKey: ["supplier-profile"] });
    },
  });


  const handleClick = (notification: Notification) => {
    if (!notification.readAt) {
      markRead.mutate(notification.id);
    }
  };

  const notifications = data?.data ?? [];

  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow="Notifications"
        title="Vendor feedback"
        description="Review vendor responses to your product uploads and take action where needed."
        actions={
          data ? (
            <span className="text-sm text-zinc-500">
              {data.unread > 0 ? (
                <Badge color="blue">{data.unread} unread</Badge>
              ) : (
                <Badge color="zinc">All read</Badge>
              )}
            </span>
          ) : null
        }
      />

      <Card>
        <CardContent className="pt-6">
          {isLoading ? (
            <Loading />
          ) : notifications.length === 0 ? (
            <Empty label="No notifications yet" hint="Upload a product file to get started" />
          ) : (
            <div className="space-y-3">
              {notifications.map((n) => {
                const isRejected = n.type === "REJECTED";
                const isAccepted = n.type === "ACCEPTED";
                // A REJECTED-type notice on an upload that is not itself
                // rejected means rows were returned for correction.
                const needsFixing =
                  n.upload.status === "INCOMPLETE" || (isRejected && n.upload.status !== "REJECTED");
                return (
                  <Link
                    key={n.id}
                    href={needsFixing ? "/supplier/incomplete" : `/supplier/uploads/${n.upload.id}`}
                    onClick={() => handleClick(n)}
                    className={`block rounded-xl border p-5 transition-all hover:shadow-md ${
                      n.readAt
                        ? "border-zinc-200 bg-white"
                        : "border-teal-200 bg-teal-50/50"
                    }`}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      {!n.readAt && (
                        <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-teal-500" />
                      )}
                      <Badge color={needsFixing ? "amber" : isRejected ? "red" : isAccepted ? "green" : "indigo"}>
                        {needsFixing ? "NEEDS FIXING" : n.type.replace("_", " ")}
                      </Badge>
                      <span className="text-xs text-zinc-400">{new Date(n.createdAt).toLocaleString()}</span>
                      <span className="ml-auto text-[11px] font-medium text-zinc-500">{n.upload.originalName}</span>
                    </div>

                    <p className="mt-3 text-sm leading-6 text-zinc-700">{n.message}</p>

                    {/* Show inline action for rejected uploads */}
                    {isRejected && n.upload.status === "REJECTED" && (
                      <div className="mt-4 rounded-lg border border-red-200 bg-white p-4">
                        <p className="text-xs font-semibold text-red-800">Action required</p>
                        <p className="mt-1 text-xs leading-5 text-red-700">
                          {n.upload.vendorNote ?? "The vendor has requested corrections. Click to view details and resubmit."}
                        </p>
                        <span className="mt-3 inline-flex min-h-8 items-center justify-center rounded-lg border border-red-200 bg-red-50 px-3 text-xs font-semibold text-red-700">
                          View upload and resubmit →
                        </span>
                      </div>
                    )}

                    {/* Show inline action for returned rows */}
                    {needsFixing && (
                      <div className="mt-4 rounded-lg border border-amber-200 bg-white p-4">
                        <p className="text-xs font-semibold text-amber-800">Action required</p>
                        <p className="mt-1 text-xs leading-5 text-amber-700">
                          Some fields in your upload are missing or incomplete. Click below to fill them in before the vendor can review.
                        </p>
                        <span className="mt-3 inline-flex min-h-8 items-center justify-center rounded-lg border border-amber-200 bg-amber-50 px-3 text-xs font-semibold text-amber-700">
                          Fill in missing fields →
                        </span>
                      </div>
                    )}
                  </Link>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}