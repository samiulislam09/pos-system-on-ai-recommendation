export const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";

const TOKEN_KEY = "inv_access_token";
const REFRESH_KEY = "inv_refresh_token";

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function setTokens(access: string, refresh: string) {
  localStorage.setItem(TOKEN_KEY, access);
  localStorage.setItem(REFRESH_KEY, refresh);
}

export function getRefreshToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(REFRESH_KEY);
}

export function clearTokens() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(REFRESH_KEY);
  window.dispatchEvent(new Event("auth-changed"));
}

export interface ApiErrorShape {
  success: false;
  error: { code: string; message: string; details?: unknown };
}

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

interface ApiFetchOptions {
  method?: string;
  body?: unknown;
  token?: string | null;
  signal?: AbortSignal;
  /** Set on the retry after a token refresh, so a second 401 does not loop. */
  retried?: boolean;
}

export async function apiFetch<T>(
  path: string,
  options: ApiFetchOptions = {},
): Promise<T> {
  const token = options.token !== undefined ? options.token : getToken();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${API_URL}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    signal: options.signal,
  });

  if (res.status === 401 && token && !options.retried) {
    const refreshedToken = await refreshSession();
    if (refreshedToken) {
      return apiFetch<T>(path, { ...options, token: refreshedToken, retried: true });
    }
    if (typeof window !== "undefined") window.location.replace("/login");
  }

  const body = (await res.json().catch(() => ({}))) as
    | { success: true; data: T }
    | ApiErrorShape;

  if (!res.ok || !body.success) {
    const err = (body as ApiErrorShape).error;
    throw new ApiError(
      err?.code ?? `HTTP_${res.status}`,
      err?.message ?? `Request failed with status ${res.status}`,
      res.status,
      err?.details,
    );
  }
  return body.data;
}

export async function login(email: string, password: string) {
  const data = await apiFetch<{
    user: { id: string; name: string; email: string; role: string };
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
  }>("/auth/login", { method: "POST", body: { email, password }, token: null });
  setTokens(data.accessToken, data.refreshToken);
  return data;
}

let refreshPromise: Promise<string | null> | null = null;

async function performRefresh(): Promise<string | null> {
  const refresh = getRefreshToken();
  if (!refresh) return null;
  try {
    const data = await apiFetch<{ accessToken: string; refreshToken: string }>("/auth/refresh", {
      method: "POST",
      body: { refreshToken: refresh },
      token: null,
    });
    setTokens(data.accessToken, data.refreshToken);
    return data.accessToken;
  } catch {
    clearTokens();
    return null;
  }
}

export function refreshSession(): Promise<string | null> {
  if (!refreshPromise) {
    refreshPromise = performRefresh().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

export async function logout(): Promise<void> {
  const refreshToken = getRefreshToken();
  try {
    if (refreshToken) {
      await apiFetch("/auth/logout", { method: "POST", body: { refreshToken } });
    }
  } catch {
    // Revoking the refresh token is best-effort; the local session ends anyway.
  } finally {
    clearTokens();
  }
}

export function isAuthenticated(): boolean {
  return !!getToken();
}
