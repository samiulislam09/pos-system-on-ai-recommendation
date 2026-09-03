import type { ReactNode, SVGProps } from "react";

export type IconName = "dashboard" | "pos" | "inventory" | "products" | "stores" | "transactions" | "reports" | "ai" | "logout" | "logo";

const paths: Record<IconName, ReactNode> = {
  dashboard: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>,
  pos: <><path d="M4 3h16v18H4z" /><path d="M8 7h8M8 11h8M8 16h2m4 0h2" /></>,
  inventory: <><path d="M4 7.5 12 3l8 4.5v9L12 21l-8-4.5z" /><path d="m4.3 7.7 7.7 4.4 7.7-4.4M12 12v9" /></>,
  products: <><path d="M5 7h14l-1 14H6z" /><path d="M9 7a3 3 0 0 1 6 0" /></>,
  stores: <><path d="M3 10h18M5 10v11h14V10M4 10l2-6h12l2 6" /><path d="M9 14h6v7" /></>,
  transactions: <><path d="M7 7h13l-3-3m3 3-3 3M17 17H4l3 3m-3-3 3-3" /></>,
  reports: <><path d="M4 20V10m6 10V4m6 16v-7m4 7H2" /></>,
  ai: <><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4" /><circle cx="12" cy="12" r="4" /></>,
  logout: <><path d="M10 4H5v16h5M14 8l4 4-4 4m4-4H9" /></>,
  logo: <><path d="M4 6.5 12 2l8 4.5v11L12 22l-8-4.5z" /><path d="m4 6.5 8 4.5 8-4.5M12 11v11" /><path d="m8 4.2 8 4.6" /></>,
};

export function Icon({ name, ...props }: { name: IconName } & SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      {paths[name]}
    </svg>
  );
}
