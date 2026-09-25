"use client";

import Link from "next/link";
import { useCallback } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getSupplierToken,
  refreshSupplierSession,
  supplierApiFetch,
  supplierLogout,
} from "@/lib/supplier-api";
import { useNotificationStream, type StreamEvent, type StreamSource } from "@/lib/notification-stream";
import { NotificationToasts, useToasts } from "@/components/toast";
import { cn } from "@/components/ui";
import { Icon, type IconName } from "@/components/icons";

const STREAM: StreamSource = {
  path: "/supplier-portal/notifications/stream",
  getToken: getSupplierToken,
  refresh: refreshSupplierSession,
};

const SUPPLIER_NAV: Array<{
  href: string;
  label: string;
  icon: IconName;
}> = [
  { href: "/supplier/dashboard", label: "Overview", icon: "dashboard" },
  { href: "/supplier/uploads", label: "My uploads", icon: "uploads" },
  { href: "/supplier/incomplete", label: "Incomplete data", icon: "alert" },
  { href: "/supplier/notifications", label: "Notifications", icon: "bell" },
];

export function SupplierSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: profile } = useQuery({
    queryKey: ["supplier-profile"],
    queryFn: () =>
      supplierApiFetch<{ report: { returnedItems?: number; unreadNotifications?: number } }>(
        "/supplier-portal/me",
      ),
  });
  const returnedBadge = profile?.report.returnedItems ?? 0;
  const unreadBadge = profile?.report.unreadNotifications ?? 0;

  const { toasts, push, dismiss } = useToasts();
  const onStreamEvent = useCallback(
    ({ message }: StreamEvent) => {
      // Every supplier-portal query key starts with "supplier-".
      queryClient.invalidateQueries({
        predicate: (q) => String(q.queryKey[0]).startsWith("supplier-"),
      });
      if (message) push(message);
    },
    [queryClient, push],
  );
  useNotificationStream(STREAM, onStreamEvent);

  const handleLogout = async () => {
    await supplierLogout();
    router.replace("/supplier/login");
  };

  return (
    <aside className="relative z-20 flex w-full shrink-0 flex-col border-b border-zinc-200 bg-white md:sticky md:top-0 md:h-screen md:w-64 md:border-b-0 md:border-r">
      <div className="flex h-[68px] items-center justify-between px-4 md:h-auto md:px-5 md:py-6">
        <Link href="/supplier/dashboard" className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-teal-700 text-white shadow-sm">
            <Icon name="logo" className="h-5 w-5" />
          </span>
          <span>
            <span className="block text-[15px] font-bold tracking-[-0.02em] text-zinc-950">Supplier Portal</span>
            <span className="block text-[10px] font-medium uppercase tracking-[0.13em] text-zinc-400">Product uploads</span>
          </span>
        </Link>
        <button onClick={handleLogout} className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-100 hover:text-red-600 md:hidden" aria-label="Log out">
          <Icon name="logout" className="h-5 w-5" />
        </button>
      </div>
      <nav className="flex flex-1 gap-1 overflow-x-auto px-3 pb-3 md:block md:px-4 md:pb-4">
        <p className="mb-2 hidden px-3 text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-400 md:block">Portal</p>
        <div className="contents md:grid md:gap-1">
          {SUPPLIER_NAV.map((item) => {
            const active = pathname.startsWith(item.href);
            const isNotifications = item.href === "/supplier/notifications";
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "group flex min-h-10 shrink-0 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-all",
                  active
                    ? "bg-teal-50 text-teal-800 md:shadow-[inset_3px_0_0_#0f766e]"
                    : "text-zinc-500 hover:bg-zinc-50 hover:text-zinc-950",
                )}
              >
                <Icon name={item.icon} className={cn("h-[18px] w-[18px]", active ? "text-teal-700" : "text-zinc-400 group-hover:text-zinc-700")} />
                <span className="flex-1 whitespace-nowrap">{item.label}</span>
                {isNotifications && unreadBadge > 0 ? (
                  <span className="ml-auto rounded-full bg-red-500 px-2 py-0.5 text-[10px] font-bold text-white">{unreadBadge}</span>
                ) : null}
                {item.href === "/supplier/incomplete" && returnedBadge > 0 ? (
                  <span className="ml-auto rounded-full bg-amber-500 px-2 py-0.5 text-[10px] font-bold text-white">{returnedBadge}</span>
                ) : null}
              </Link>
            );
          })}
        </div>
      </nav>
      <div className="border-t border-zinc-100 p-4">
        <div className="mb-2 flex items-center gap-3 px-2 py-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-zinc-900 text-xs font-bold text-white">SP</span>
          <span className="min-w-0">
            <span className="block truncate text-xs font-semibold text-zinc-800">Supplier Portal</span>
            <span className="block truncate text-[11px] text-zinc-400">Supplier workspace</span>
          </span>
        </div>
        <button
          onClick={handleLogout}
          className="flex min-h-10 w-full items-center gap-3 rounded-lg px-3 text-left text-sm font-medium text-zinc-500 hover:bg-red-50 hover:text-red-700"
        >
          <Icon name="logout" className="h-[18px] w-[18px]" /> Log out
        </button>
      </div>
      <NotificationToasts toasts={toasts} dismiss={dismiss} href="/supplier/notifications" />
    </aside>
  );
}

