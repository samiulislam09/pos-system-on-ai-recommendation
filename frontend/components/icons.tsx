import type { ReactNode, SVGProps } from "react";

export type IconName = "dashboard" | "pos" | "inventory" | "products" | "stores" | "transactions" | "reports" | "ai" | "logout" | "logo" | "suppliers" | "uploads" | "bell" | "alert";

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
  suppliers: <><path d="M12 3v2M12 19v2M3 12h2M19 12h2" /><circle cx="12" cy="12" r="4" /><path d="M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4" /></>,
  uploads: <><path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242" /><path d="M12 12v9" /><path d="m16 16-4-4-4 4" /></>,
  bell: <><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /></>,
  alert: <><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /><path d="M12 9v4" /><path d="M12 17h.01" /></>,
};

export function Icon({ name, ...props }: { name: IconName } & SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      {paths[name]}
    </svg>
  );
}
