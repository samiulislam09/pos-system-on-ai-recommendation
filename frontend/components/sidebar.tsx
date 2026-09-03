"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { logout } from "@/lib/api";
import { cn } from "@/components/ui";
import { Icon, type IconName } from "@/components/icons";

const NAV: Array<{ href: string; label: string; icon: IconName; group: "Workspace" | "Operations" }> = [
  { href: "/dashboard", label: "Overview", icon: "dashboard", group: "Workspace" },
  { href: "/pos", label: "Point of sale", icon: "pos", group: "Workspace" },
  { href: "/inventory", label: "Inventory", icon: "inventory", group: "Operations" },
  { href: "/products", label: "Products", icon: "products", group: "Operations" },
  { href: "/stores", label: "Locations", icon: "stores", group: "Operations" },
  { href: "/transactions", label: "Transactions", icon: "transactions", group: "Operations" },
  { href: "/reports", label: "Reports", icon: "reports", group: "Operations" },
  { href: "/ai-insights", label: "AI Insights", icon: "ai", group: "Operations" },
];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();

  const handleLogout = async () => {
    await logout();
    router.replace("/login");
  };

  return (
    <aside className="relative z-20 flex w-full shrink-0 flex-col border-b border-zinc-200 bg-white md:sticky md:top-0 md:h-screen md:w-64 md:border-b-0 md:border-r">
      <div className="flex h-[68px] items-center justify-between px-4 md:h-auto md:px-5 md:py-6">
        <Link href="/dashboard" className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-teal-700 text-white shadow-sm">
            <Icon name="logo" className="h-5 w-5" />
          </span>
          <span>
            <span className="block text-[15px] font-bold tracking-[-0.02em] text-zinc-950">Inventory OS</span>
            <span className="block text-[10px] font-medium uppercase tracking-[0.13em] text-zinc-400">Operations console</span>
          </span>
        </Link>
        <button onClick={handleLogout} className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-100 hover:text-red-600 md:hidden" aria-label="Log out">
          <Icon name="logout" className="h-5 w-5" />
        </button>
      </div>
      <nav className="flex gap-1 overflow-x-auto px-3 pb-3 md:block md:flex-1 md:overflow-visible md:px-4 md:pb-4">
        {(["Workspace", "Operations"] as const).map((group) => (
          <div key={group} className="contents md:mb-6 md:block">
            <p className="mb-2 hidden px-3 text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-400 md:block">{group}</p>
            <div className="contents md:grid md:gap-1">
              {NAV.filter((item) => item.group === group).map((item) => {
                const active = pathname.startsWith(item.href);
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
                    <span className="whitespace-nowrap">{item.label}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>
      <div className="hidden border-t border-zinc-100 p-4 md:block">
        <div className="mb-2 flex items-center gap-3 px-2 py-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-zinc-900 text-xs font-bold text-white">DA</span>
          <span className="min-w-0">
            <span className="block truncate text-xs font-semibold text-zinc-800">Demo Admin</span>
            <span className="block truncate text-[11px] text-zinc-400">Demo workspace</span>
          </span>
        </div>
        <button
          onClick={handleLogout}
          className="flex min-h-10 w-full items-center gap-3 rounded-lg px-3 text-left text-sm font-medium text-zinc-500 hover:bg-red-50 hover:text-red-700"
        >
          <Icon name="logout" className="h-[18px] w-[18px]" /> Log out
        </button>
      </div>
    </aside>
  );
}
