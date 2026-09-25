// Mirrors backend/apps/api/src/supplier-portal/etl.util.ts — keep the column
// list and the empty rule identical.
export const ETL_COLUMNS = [
  { column: "po_number", key: "poNumber", label: "PO #", kind: "text" },
  { column: "vendor_id", key: "vendorId", label: "Vendor ID", kind: "text" },
  { column: "vendor_name", key: "vendorName", label: "Vendor name", kind: "text" },
  { column: "sku", key: "sku", label: "SKU", kind: "text" },
  { column: "item_description", key: "itemDescription", label: "Description", kind: "text" },
  { column: "category", key: "category", label: "Category", kind: "text" },
  { column: "order_qty", key: "orderQty", label: "Qty", kind: "number" },
  { column: "unit_price_bdt", key: "unitPriceBdt", label: "Unit price", kind: "number" },
  { column: "total_amount_bdt", key: "totalAmountBdt", label: "Total", kind: "number" },
  { column: "order_date", key: "orderDate", label: "Order date", kind: "text" },
  { column: "delivery_date", key: "deliveryDate", label: "Delivery date", kind: "text" },
  { column: "status", key: "status", label: "Status", kind: "text" },
] as const;

export type EtlKey = (typeof ETL_COLUMNS)[number]["key"];
export type EditableRow = Record<EtlKey, string>;
export const NUMBER_KEYS: EtlKey[] = ["orderQty", "unitPriceBdt", "totalAmountBdt"];

export function findEmptyColumns(row: EditableRow): string[] {
  return ETL_COLUMNS.filter(({ key, kind }) => {
    const raw = (row[key] ?? "").trim();
    if (kind === "number") {
      const n = Number(raw);
      return raw === "" || !Number.isFinite(n) || n <= 0;
    }
    return raw.length === 0;
  }).map((c) => c.column);
}

export function toEditableRow(item: Record<EtlKey, string | number | null>): EditableRow {
  return Object.fromEntries(
    ETL_COLUMNS.map(({ key }) => [key, item[key] === null || item[key] === undefined ? "" : String(item[key])]),
  ) as EditableRow;
}
