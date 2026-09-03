import { API_URL, getToken, refreshSession } from "@/lib/api";

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Download a store's sales as CSV for a [from, to] date range (YYYY-MM-DD, inclusive). */
export async function downloadSalesCsv(opts: {
  storeId: string;
  storeCode: string;
  from: string;
  to: string;
}): Promise<void> {
  const params = new URLSearchParams({
    storeId: opts.storeId,
    from: new Date(`${opts.from}T00:00:00.000Z`).toISOString(),
    to: new Date(`${opts.to}T23:59:59.999Z`).toISOString(),
  });
  const request = (token: string | null) =>
    fetch(`${API_URL}/sales/export?${params}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
  let res = await request(getToken());
  if (res.status === 401) {
    const fresh = await refreshSession();
    if (fresh) res = await request(fresh);
  }
  if (!res.ok) throw new Error(`Export failed (HTTP ${res.status})`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `sales-${opts.storeCode}-${opts.from}${opts.from === opts.to ? "" : `_${opts.to}`}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
