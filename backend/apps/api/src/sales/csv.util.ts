/** CSV building for sales exports — pure functions, one row per sale item. */

export function csvEscape(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export interface SaleExportRow {
  transactionNumber: string;
  createdAt: Date;
  status: string;
  paymentStatus: string;
  store: { name: string; code: string } | null;
  terminal: { terminalCode: string } | null;
  payments: { method: string }[];
  subtotal: unknown;
  total: unknown;
  items: {
    quantity: number;
    unitPrice: unknown;
    total: unknown;
    product: { sku: string; name: string };
  }[];
}

export const SALES_CSV_HEADER = [
  "transaction_number",
  "datetime",
  "store",
  "store_code",
  "terminal",
  "sku",
  "product",
  "quantity",
  "unit_price",
  "line_total",
  "sale_subtotal",
  "sale_total",
  "sale_status",
  "payment_status",
  "payment_method",
].join(",");

export function buildSalesCsv(sales: SaleExportRow[]): string {
  const lines = [SALES_CSV_HEADER];
  for (const sale of sales) {
    for (const item of sale.items) {
      lines.push(
        [
          sale.transactionNumber,
          sale.createdAt.toISOString(),
          sale.store?.name ?? "",
          sale.store?.code ?? "",
          sale.terminal?.terminalCode ?? "",
          item.product.sku,
          item.product.name,
          item.quantity,
          item.unitPrice,
          item.total,
          sale.subtotal,
          sale.total,
          sale.status,
          sale.paymentStatus,
          sale.payments[0]?.method ?? "",
        ]
          .map(csvEscape)
          .join(","),
      );
    }
  }
  return lines.join("\r\n") + "\r\n";
}
