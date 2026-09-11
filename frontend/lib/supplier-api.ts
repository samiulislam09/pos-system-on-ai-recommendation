import { API_URL } from "@/lib/api";

const S_TOKEN_KEY = "sup_access_token";
const S_REFRESH_KEY = "sup_refresh_token";

export function getSupplierToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(S_TOKEN_KEY);
}

export function setSupplierTokens(access: string, refresh: string) {
  localStorage.setItem(S_TOKEN_KEY, access);
  localStorage.setItem(S_REFRESH_KEY, refresh);
}

function getSupplierRefreshToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(S_REFRESH_KEY);
}

export function clearSupplierTokens() {
  localStorage.removeItem(S_TOKEN_KEY);
  localStorage.removeItem(S_REFRESH_KEY);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("supplier-auth-changed"));
  }
}

export function isSupplierAuthenticated(): boolean {
  return !!getSupplierToken();
}

interface ApiErrorShape {
  success: false;
  error: { code: string; message: string; details?: unknown };
}

export class SupplierApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "SupplierApiError";
  }
}

interface SupplierFetchOptions {
  method?: string;
  body?: unknown;
  token?: string | null;
}

export async function supplierApiFetch<T>(
  path: string,
  options: SupplierFetchOptions = {},
): Promise<T> {
  const token = options.token !== undefined ? options.token : getSupplierToken();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${API_URL}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  if (res.status === 401 && token) {
    const refreshed = await refreshSupplierSession();
    if (refreshed) {
      return supplierApiFetch<T>(path, { ...options, token: refreshed });
    }
    clearSupplierTokens();
    if (typeof window !== "undefined") window.location.replace("/supplier/login");
  }

  const body = (await res.json().catch(() => ({}))) as
    | { success: true; data: T }
    | ApiErrorShape;

  if (!res.ok || !body.success) {
    const err = (body as ApiErrorShape).error;
    throw new SupplierApiError(
      err?.code ?? `HTTP_${res.status}`,
      err?.message ?? `Request failed with status ${res.status}`,
      res.status,
      err?.details,
    );
  }
  return body.data;
}

export async function supplierLogin(email: string, password: string) {
  const data = await supplierApiFetch<{
    supplier: {
      id: string;
      name: string;
      email: string;
      phone: string | null;
      organizationId: string;
      supplierId: string | null;
      supplierName: string | null;
    };
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
  }>("/auth/supplier-login", {
    method: "POST",
    body: { email, password },
    token: null,
  });
  setSupplierTokens(data.accessToken, data.refreshToken);
  return data;
}

let refreshPromise: Promise<string | null> | null = null;

async function performSupplierRefresh(): Promise<string | null> {
  const refresh = getSupplierRefreshToken();
  if (!refresh) return null;
  try {
    const data = await supplierApiFetch<{ accessToken: string; refreshToken: string }>(
      "/auth/supplier-refresh",
      { method: "POST", body: { refreshToken: refresh }, token: null },
    );
    setSupplierTokens(data.accessToken, data.refreshToken);
    return data.accessToken;
  } catch {
    clearSupplierTokens();
    return null;
  }
}

export function refreshSupplierSession(): Promise<string | null> {
  if (!refreshPromise) {
    refreshPromise = performSupplierRefresh().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

export async function supplierLogout(): Promise<void> {
  const refreshToken = getSupplierRefreshToken();
  try {
    if (refreshToken) {
      await supplierApiFetch("/auth/supplier-logout", {
        method: "POST",
        body: { refreshToken },
      });
    }
  } finally {
    clearSupplierTokens();
  }
}