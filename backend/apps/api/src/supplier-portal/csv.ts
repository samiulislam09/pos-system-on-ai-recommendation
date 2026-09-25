import { DomainException, ErrorCodes } from "../common/errors";

export interface ParsedShipmentRow {
  poNumber: string;
  vendorId: string;
  vendorName: string;
  sku: string;
  itemDescription: string;
  category: string;
  orderQty: number;
  unitPriceBdt: number;
  totalAmountBdt: number;
  orderDate: string;
  deliveryDate: string;
  status: string;
}

export interface RowIssue {
  row: number;
  field: string;
  message: string;
}

export interface ParsedCsvShipment {
  rows: ParsedShipmentRow[];
  issues: RowIssue[];
  missingFields: Array<{ row: number; fields: string[] }>;
}

const REQUIRED_HEADERS = [
  "po_number",
  "sku",
  "item_description",
  "order_qty",
  "unit_price_bdt",
  "total_amount_bdt",
] as const;

/**
 * Minimal RFC-4180 style CSV parser that understands quoted fields and
 * quoted-field-embedded commas/newlines. Designed for supplier product files.
 */
export function parseCsv(text: string): string[][] {
  const out: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") {
        i++;
      }
      row.push(field);
      field = "";
      out.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    out.push(row);
  }
  // Drop trailing blank rows.
  return out.filter(
    (r) => r.some((cell) => cell.trim().length > 0),
  );
}

function numericCells(row: string[], headers: string[], name: string): number | null {
  const idx = headers.indexOf(name);
  if (idx === -1) return null;
  const raw = (row[idx] ?? "").trim();
  if (raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export function parseShipmentCsv(fileName: string, content: string): ParsedCsvShipment {
  let table: string[][];
  try {
    table = parseCsv(content);
  } catch {
    throw new DomainException(
      ErrorCodes.VALIDATION_ERROR,
      `"${fileName}" is not a valid CSV file`,
      400,
    );
  }
  if (table.length < 2) {
    throw new DomainException(
      ErrorCodes.VALIDATION_ERROR,
      `"${fileName}" must contain a header row and at least one product row`,
      400,
    );
  }

  const headers = table[0].map((h) => h.trim().toLowerCase());
  const missingHeaders = REQUIRED_HEADERS.filter((h) => !headers.includes(h));
  if (missingHeaders.length > 0) {
    throw new DomainException(
      ErrorCodes.VALIDATION_ERROR,
      `Missing required columns: ${missingHeaders.join(", ")}`,
      400,
    );
  }

  const col = (name: string) => headers.indexOf(name);

  const rows: ParsedShipmentRow[] = [];
  const issues: RowIssue[] = [];
  const missingFields: Array<{ row: number; fields: string[] }> = [];

  table.slice(1).forEach((cells, i) => {
    const lineNumber = i + 2;
    const at = (name: string) => {
      const idx = col(name);
      return idx === -1 ? "" : (cells[idx] ?? "").trim();
    };

    const requiredFields: Array<[string, string, (v: string) => boolean]> = [
      ["po_number", "po_number", (v) => v.length > 0],
      ["sku", "sku", (v) => v.length > 0],
      ["item_description", "item_description", (v) => v.length > 0],
    ];
    const rowIssues: RowIssue[] = [];
    const rowMissing: string[] = [];
    for (const [name, label, ok] of requiredFields) {
      if (!ok(at(name))) {
        rowIssues.push({
          row: lineNumber,
          field: label,
          message: `${label} is missing`,
        });
        rowMissing.push(name);
      }
    }

    const orderQty = numericCells(cells, headers, "order_qty");
    const unitPrice = numericCells(cells, headers, "unit_price_bdt");
    const totalAmount = numericCells(cells, headers, "total_amount_bdt");

    if (orderQty === null || orderQty < 0) {
      rowIssues.push({ row: lineNumber, field: "order_qty", message: "order_qty must be a non-negative number" });
      if (orderQty === null) rowMissing.push("order_qty");
    }
    if (unitPrice === null || unitPrice < 0) {
      rowIssues.push({ row: lineNumber, field: "unit_price_bdt", message: "unit_price_bdt must be a non-negative number" });
      if (unitPrice === null) rowMissing.push("unit_price_bdt");
    }
    if (totalAmount === null || totalAmount < 0) {
      rowIssues.push({ row: lineNumber, field: "total_amount_bdt", message: "total_amount_bdt must be a non-negative number" });
      if (totalAmount === null) rowMissing.push("total_amount_bdt");
    }

    rows.push({
      poNumber: at("po_number"),
      vendorId: at("vendor_id"),
      vendorName: at("vendor_name"),
      sku: at("sku"),
      itemDescription: at("item_description"),
      category: at("category"),
      orderQty: Math.trunc(orderQty ?? 0),
      unitPriceBdt: unitPrice ?? 0,
      totalAmountBdt: totalAmount ?? 0,
      orderDate: at("order_date"),
      deliveryDate: at("delivery_date"),
      status: at("status"),
    });
    issues.push(...rowIssues);
    if (rowMissing.length > 0) {
      missingFields.push({ row: lineNumber, fields: rowMissing });
    }
  });

  // Check for duplicate SKUs / duplicate (po_number, sku) lines in the batch
  const seenSkuMap = new Map<string, number>();
  rows.forEach((row, idx) => {
    const lineNumber = idx + 2;
    const sku = row.sku.trim().toUpperCase();
    if (!sku) return;

    if (seenSkuMap.has(sku)) {
      const prevLine = seenSkuMap.get(sku)!;
      issues.push({
        row: lineNumber,
        field: "sku",
        message: `Duplicate SKU "${row.sku}" found in upload (already appears on row ${prevLine})`,
      });
    } else {
      seenSkuMap.set(sku, lineNumber);
    }
  });

  return { rows, issues, missingFields };
}