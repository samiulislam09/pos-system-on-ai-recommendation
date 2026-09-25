export type Numeric = number | string | { toString(): string };

export interface EtlRow {
  poNumber: string;
  vendorId: string;
  vendorName: string;
  sku: string;
  itemDescription: string;
  category: string;
  orderQty: Numeric;
  unitPriceBdt: Numeric;
  totalAmountBdt: Numeric;
  orderDate: string | null;
  deliveryDate: string | null;
  status: string | null;
}

export const ETL_COLUMNS: ReadonlyArray<{
  column: string;
  key: keyof EtlRow;
  kind: "text" | "number";
}> = [
  { column: "po_number", key: "poNumber", kind: "text" },
  { column: "vendor_id", key: "vendorId", kind: "text" },
  { column: "vendor_name", key: "vendorName", kind: "text" },
  { column: "sku", key: "sku", kind: "text" },
  { column: "item_description", key: "itemDescription", kind: "text" },
  { column: "category", key: "category", kind: "text" },
  { column: "order_qty", key: "orderQty", kind: "number" },
  { column: "unit_price_bdt", key: "unitPriceBdt", kind: "number" },
  { column: "total_amount_bdt", key: "totalAmountBdt", kind: "number" },
  { column: "order_date", key: "orderDate", kind: "text" },
  { column: "delivery_date", key: "deliveryDate", kind: "text" },
  { column: "status", key: "status", kind: "text" },
];

export const DUPLICATE_SKU = "duplicate_sku";

/** Stocking needs a SKU and a quantity, so these are checked even when unselected. */
export const REQUIRED_COLUMNS = ["sku", "order_qty"];

export function normalizeSku(sku: string): string {
  return sku.trim().toUpperCase();
}

/**
 * CSV column names whose value is empty. The CSV parser stores a missing
 * number as 0, so a non-positive quantity or price also counts as empty.
 * With `columns`, only those columns (plus the required ones) are checked.
 */
export function findEmptyColumns(row: EtlRow, columns?: readonly string[]): string[] {
  return ETL_COLUMNS.filter(({ column, key, kind }) => {
    if (columns && !columns.includes(column) && !REQUIRED_COLUMNS.includes(column)) return false;
    const raw = String(row[key] ?? "");
    if (kind === "number") {
      const n = Number(raw);
      return raw.trim() === "" || !Number.isFinite(n) || n <= 0;
    }
    return raw.trim().length === 0;
  }).map((c) => c.column);
}

export function classifyRows<T extends EtlRow & { id: string }>(
  rows: T[],
  existingSkus: Iterable<string>,
  columns?: readonly string[],
): Array<{ id: string; status: "GOOD" | "INCOMPLETE"; missing: string[] }> {
  const seen = new Set([...existingSkus].map(normalizeSku).filter(Boolean));
  return rows.map((row) => {
    const missing = findEmptyColumns(row, columns);
    const sku = normalizeSku(row.sku);
    if (sku) {
      if (seen.has(sku)) missing.push(DUPLICATE_SKU);
      else seen.add(sku);
    }
    return { id: row.id, status: missing.length > 0 ? "INCOMPLETE" : "GOOD", missing };
  });
}
