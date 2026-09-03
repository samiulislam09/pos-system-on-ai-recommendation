import { ApiError, apiFetch } from "@/lib/api";

export interface Terminal {
  id: string;
  terminalCode: string;
}

export interface Store {
  id: string;
  name: string;
  code: string;
  terminals: Terminal[];
}

export interface Product {
  id: string;
  sku: string;
  name: string;
  unit: string;
  sellingPrice: number | string;
  quantity: number;
  reservedQuantity: number;
  availableQuantity: number;
  matchedCode?: string | null;
  matchedCodeType?: string | null;
}

export interface CartLine {
  product: Product;
  quantity: number;
}

export type PaymentMethod = "CASH" | "CARD" | "MOBILE_PAYMENT";

export interface PendingSale {
  readonly eventId: string;
  readonly type: "SALE";
  readonly storeId: string;
  readonly terminalId?: string;
  readonly timestamp: string;
  readonly items: ReadonlyArray<Readonly<{ sku: string; quantity: number }>>;
  readonly payment?: Readonly<{ method: PaymentMethod; amountTendered?: number }>;
}

export interface ProcessResult {
  status: "PROCESSED" | "DUPLICATE" | "PROCESSING" | string;
  transactionId?: string;
  transaction?: SaleConfirmation;
}

export interface EventStatus {
  status: string;
  transactionId?: string;
  transaction?: SaleConfirmation;
}

export interface SaleConfirmation {
  id?: string;
  transactionId?: string;
  transactionNumber?: string;
  total?: number | string;
  paymentStatus?: string;
  store?: { id?: string; name?: string } | null;
  terminal?: { id?: string; terminalCode?: string } | null;
  items?: unknown[];
}

export function getBootstrap(signal?: AbortSignal) {
  return apiFetch<{ stores: Store[] }>("/pos/bootstrap", { signal });
}

export function searchProducts(storeId: string, query: string, signal?: AbortSignal) {
  const params = new URLSearchParams({ storeId, q: query, limit: "25" });
  return apiFetch<{ products: Product[] }>(`/pos/products?${params}`, { signal });
}

export function submitSale(sale: PendingSale) {
  return apiFetch<ProcessResult>("/events", { method: "POST", body: sale });
}

export function getEvent(eventId: string) {
  return apiFetch<EventStatus>(`/events/${encodeURIComponent(eventId)}`);
}

export function getSale(transactionId: string) {
  return apiFetch<SaleConfirmation>(`/sales/${encodeURIComponent(transactionId)}`);
}

export function isExplicitClientError(error: unknown) {
  return error instanceof ApiError && error.status >= 400 && error.status < 500;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function resolveResult(result: ProcessResult): Promise<SaleConfirmation | null> {
  if (result.status !== "PROCESSED" && result.status !== "DUPLICATE") return null;
  if (result.status === "DUPLICATE" && result.transactionId) return getSale(result.transactionId);
  if (result.transaction) return result.transaction;
  if (result.transactionId) return getSale(result.transactionId);
  return null;
}

export async function reconcileSale(eventId: string, attempts = 5): Promise<SaleConfirmation | null> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const event = await getEvent(eventId);
      if (event.status === "PROCESSED" || event.status === "DUPLICATE") {
        if (event.transactionId) return await getSale(event.transactionId);
        if (event.transaction) return event.transaction;
      }
      if (event.status === "FAILED" || event.status === "REJECTED") {
        throw new ApiError("EVENT_REJECTED", "The sale was rejected by the server.", 422, event);
      }
    } catch (error) {
      if (error instanceof ApiError && error.code === "EVENT_REJECTED") throw error;
    }
    if (attempt < attempts - 1) await wait(1200);
  }
  return null;
}
