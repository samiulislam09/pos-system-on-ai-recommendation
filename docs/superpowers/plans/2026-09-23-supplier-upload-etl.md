# Supplier Upload ETL Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the vendor run ETL on a supplier upload to separate good rows from incomplete ones. Good rows are stocked in batches to any store, incomplete rows go back to the supplier, and the supplier fixes and resubmits them from a new editable "Incomplete data" page.

**Architecture:** Each `SupplierUploadItem` row gets an ETL status (`NEW → GOOD|INCOMPLETE → RETURNED → NEW`, `GOOD → STOCKED`). The upload's status is derived from its rows by a pure function after every change. All classification rules live in pure, unit-tested functions (`etl.util.ts`, `upload-status.util.ts`, `accept-selection.util.ts`), and the NestJS services are thin transactional wrappers around them.

**Tech Stack:** NestJS 11 + Prisma 6 (Postgres), Zod (`@inv/validation`), Jest + ts-jest, Next.js (app router, client components) + TanStack Query + Tailwind.

**Spec:** `docs/superpowers/specs/2026-09-23-supplier-upload-etl-design.md`

## Global Constraints

- Incomplete means **any** of the 12 CSV columns is empty: `po_number, vendor_id, vendor_name, sku, item_description, category, order_qty, unit_price_bdt, total_amount_bdt, order_date, delivery_date, status`. Text is empty when blank after trimming. Numbers are empty when missing, non-numeric, or `<= 0`.
- Duplicate SKUs (trimmed, case-insensitive) make the second and later rows INCOMPLETE with the reason `duplicate_sku`. Duplicates are also checked against rows in the same upload that are already GOOD or STOCKED.
- Every new upload is created as `DRAFT`. Uploads are never blocked at upload time.
- Returning incomplete rows is a separate manual vendor action with an optional note (≤ 2000 chars). ETL itself never sends rows back.
- Resubmitted rows go back into their **original** upload as `NEW`.
- Supplier resubmit is all-or-nothing. It fails with HTTP 400, code `VALIDATION_ERROR`, and `details.rows: [{ id, fields[] }]`.
- Whole-file reject is allowed only while no row of the upload is `STOCKED`.
- The `/supplier/uploads/[id]/fix` page, `POST /supplier-portal/uploads/:id/fix`, `fixItems`, and `fixSupplierUploadSchema` are deleted.
- Backend dependencies exist **only inside Docker**. Run every backend command with `docker exec inventory-api sh -c "cd /app/<path> && …"`, and every frontend typecheck with `docker exec inventory-web sh -c "cd /app && ./node_modules/.bin/tsc -p tsconfig.json --noEmit"`. The repo at `/Volumes/work/personal/pos/backend` is mounted at `/app` in `inventory-api`, and `/Volumes/work/personal/pos/frontend` at `/app` in `inventory-web`.
- After changing `packages/validation` or `packages/database`, rebuild its `dist` (`npx tsc -p tsconfig.json` in that package inside the container), because the running API imports the `dist/` output. Jest maps these packages to `src/`.
- Frontend: read the relevant guide in `frontend/node_modules/next/dist/docs/` before using any Next.js API not already used in the file you edit (see `frontend/AGENTS.md`).
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

## Review Focus

1. **Whitespace-only values** (`"  "`) must count as empty, not as filled in. Pinned in Task 2 (`findEmptyColumns`).
2. **The same SKU with different case or spacing** (`" sku_a"` vs. `"SKU_A"`) must be treated as a duplicate. Pinned in Task 2 (`classifyRows`).
3. **A resubmitted row whose SKU matches a row already STOCKED in the same upload** must go back to INCOMPLETE with `duplicate_sku` when ETL runs again, not get stocked twice. Pinned in Task 2 (`classifyRows` with `existingSkus`).
4. **A resubmit payload listing the same row id twice** must be rejected before anything is written. Pinned in Task 4 (schema refine).
5. **Stocking with a row id that isn't GOOD** (stale page, a row already stocked or returned) must reject the whole request, not stock a partial set. Pinned in Task 5 (`selectGoodItems`).

Prisma's `Decimal` values arrive as strings such as `"90.00"` and `"0.00"`. These must be read numerically, which is pinned in Task 2.

---

## File Structure

**Backend (`/Volumes/work/personal/pos/backend`)**
- Modify `packages/database/prisma/schema.prisma`: add the `SupplierItemEtlStatus` enum, three new item columns, and the Location back-relation.
- Create `packages/database/prisma/migrations/<timestamp>_supplier_item_etl/migration.sql` (generated, then backfill SQL appended).
- Create `apps/api/src/supplier-portal/etl.util.ts` + `etl.util.spec.ts`: completeness and duplicate classification (pure).
- Modify `apps/api/src/supplier-portal/upload-status.util.ts` + spec: `deriveUploadStatus` (pure) and `syncUploadStatus` (tx helper). Remove `initialUploadStatus`.
- Modify `apps/api/src/supplier-portal/accept-selection.util.ts` + spec: replace `filterAcceptItems` with `selectGoodItems`.
- Modify `packages/validation/src/index.ts`: add `returnIncompleteSchema` and `resubmitIncompleteItemsSchema`; delete `fixSupplierUploadSchema`.
- Create `apps/api/src/supplier-portal/validation.spec.ts`: tests for the new schemas.
- Modify `apps/api/src/supplier-portal/supplier-portal.service.ts` + `supplier-portal.controller.ts`: vendor ETL, stocking, return, and reject guard.
- Modify `apps/api/src/supplier-portal/supplier-uploads.service.ts` + `supplier-uploads.controller.ts`: DRAFT on upload, incomplete-items list/resubmit, profile count, fix flow removed.

**Frontend (`/Volumes/work/personal/pos/frontend`)**
- Create `lib/supplier-etl.ts`: browser mirror of the column list and empty check.
- Rewrite `app/(app)/supplier-uploads/[id]/page.tsx`: vendor ETL page.
- Create `app/supplier/incomplete/page.tsx`: supplier editable table.
- Modify `components/supplier-sidebar.tsx` and `components/icons.tsx`: new nav item with a badge.
- Modify `app/supplier/dashboard/page.tsx`, `app/supplier/notifications/page.tsx`, `app/supplier/uploads/[id]/page.tsx`: links point to `/supplier/incomplete`.
- Delete `app/supplier/uploads/[id]/fix/page.tsx`.

---

### Task 1: Schema, migration, and backfill

**Files:**
- Modify: `backend/packages/database/prisma/schema.prisma` (enum block near line 124, `model Location` near line 232, `model SupplierUploadItem` near line 803)
- Create: `backend/packages/database/prisma/migrations/<timestamp>_supplier_item_etl/migration.sql`

**Interfaces:**
- Produces: Prisma enum `SupplierItemEtlStatus { NEW GOOD INCOMPLETE RETURNED STOCKED }`, exported from `@inv/database`. `SupplierUploadItem.etlStatus`, `.stockedLocationId`, `.stockedLocation`, `.stockedAt`.

- [ ] **Step 1: Add the enum** after the `SupplierUploadStatus` enum:

```prisma
enum SupplierItemEtlStatus {
  NEW
  GOOD
  INCOMPLETE
  RETURNED
  STOCKED
}
```

- [ ] **Step 2: Add the item columns.** In `model SupplierUploadItem`, after `missingFields   Json?`:

```prisma
  etlStatus         SupplierItemEtlStatus @default(NEW)
  stockedLocationId String?
  stockedLocation   Location?             @relation(fields: [stockedLocationId], references: [id], onDelete: Restrict)
  stockedAt         DateTime?
```

and add `  @@index([uploadId, etlStatus])` next to the existing `@@index([uploadId])`.

- [ ] **Step 3: Add the back-relation.** In `model Location`, after `supplierUploads SupplierUpload[]`:

```prisma
  stockedSupplierItems SupplierUploadItem[]
```

- [ ] **Step 4: Generate the migration without applying it**

Run: `docker exec inventory-api sh -c "cd /app/packages/database && npx prisma migrate dev --create-only --name supplier_item_etl"`
Expected: `Prisma Migration created` and a new folder `prisma/migrations/<timestamp>_supplier_item_etl/`.

- [ ] **Step 5: Append the backfill** to the end of that folder's `migration.sql`:

```sql
-- Backfill: rows of accepted uploads are already in stock.
UPDATE "SupplierUploadItem" i
SET "etlStatus" = 'STOCKED', "stockedLocationId" = u."locationId", "stockedAt" = u."acceptedAt"
FROM "SupplierUpload" u
WHERE i."uploadId" = u.id AND u.status = 'ACCEPTED';

-- Backfill: flagged rows of incomplete uploads are waiting on the supplier.
UPDATE "SupplierUploadItem" i
SET "etlStatus" = 'RETURNED'
FROM "SupplierUpload" u
WHERE i."uploadId" = u.id
  AND u.status = 'INCOMPLETE'
  AND jsonb_array_length(COALESCE(i."missingFields", '[]'::jsonb)) > 0;

-- Incomplete uploads that still hold unflagged rows now need vendor ETL.
UPDATE "SupplierUpload" u
SET status = 'PENDING'
WHERE u.status = 'INCOMPLETE'
  AND EXISTS (SELECT 1 FROM "SupplierUploadItem" i WHERE i."uploadId" = u.id AND i."etlStatus" = 'NEW');
```

- [ ] **Step 6: Apply, regenerate, and rebuild the package**

Run: `docker exec inventory-api sh -c "cd /app/packages/database && npx prisma migrate dev && npx tsc -p tsconfig.json"`
Expected: `Your database is now in sync with your schema.` and `Generated Prisma Client`, with no tsc output.

- [ ] **Step 7: Verify the backfill**

Run: `docker exec inventory-postgres psql -U inventory -d inventory_platform -c "select u.status, i.\"etlStatus\", count(*) from \"SupplierUploadItem\" i join \"SupplierUpload\" u on u.id=i.\"uploadId\" group by 1,2 order by 1,2;"`
Expected: ACCEPTED uploads show only `STOCKED`; INCOMPLETE uploads show only `RETURNED`; PENDING/REJECTED/DRAFT show `NEW` (plus possibly `NEW` for uploads promoted from INCOMPLETE to PENDING).

- [ ] **Step 8: Commit**

```bash
git add backend/packages/database/prisma/schema.prisma backend/packages/database/prisma/migrations
git commit -m "feat(db): add per-row ETL status to supplier upload items

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: ETL classification (pure)

**Files:**
- Create: `backend/apps/api/src/supplier-portal/etl.util.ts`
- Test: `backend/apps/api/src/supplier-portal/etl.util.spec.ts`

**Interfaces:**
- Produces:
  - `type Numeric = number | string | { toString(): string }`
  - `interface EtlRow { poNumber: string; vendorId: string; vendorName: string; sku: string; itemDescription: string; category: string; orderQty: Numeric; unitPriceBdt: Numeric; totalAmountBdt: Numeric; orderDate: string | null; deliveryDate: string | null; status: string | null }`
  - `const ETL_COLUMNS: ReadonlyArray<{ column: string; key: keyof EtlRow; kind: "text" | "number" }>`
  - `const DUPLICATE_SKU = "duplicate_sku"`
  - `function normalizeSku(sku: string): string`
  - `function findEmptyColumns(row: EtlRow): string[]` (CSV column names, in `ETL_COLUMNS` order)
  - `function classifyRows<T extends EtlRow & { id: string }>(rows: T[], existingSkus: Iterable<string>): Array<{ id: string; status: "GOOD" | "INCOMPLETE"; missing: string[] }>`

- [ ] **Step 1: Write the failing test**

```ts
import { classifyRows, DUPLICATE_SKU, findEmptyColumns, type EtlRow } from "./etl.util";

const full: EtlRow = {
  poNumber: "PO-1",
  vendorId: "VEND_BD_001",
  vendorName: "Aarong",
  sku: "SKU_A",
  itemDescription: "Milk 1L",
  category: "Dairy",
  orderQty: 10,
  unitPriceBdt: "90.00",
  totalAmountBdt: "900.00",
  orderDate: "2026-07-15",
  deliveryDate: "2026-07-17",
  status: "Pending",
};

describe("findEmptyColumns", () => {
  it("returns nothing for a fully filled row", () => {
    expect(findEmptyColumns(full)).toEqual([]);
  });

  it("flags blank and whitespace-only text columns", () => {
    expect(findEmptyColumns({ ...full, vendorId: "", category: "   " })).toEqual([
      "vendor_id",
      "category",
    ]);
  });

  it("flags null text columns", () => {
    expect(findEmptyColumns({ ...full, orderDate: null, status: null })).toEqual([
      "order_date",
      "status",
    ]);
  });

  it("flags zero, non-numeric and decimal-string zero numbers", () => {
    expect(
      findEmptyColumns({ ...full, orderQty: 0, unitPriceBdt: "abc", totalAmountBdt: "0.00" }),
    ).toEqual(["order_qty", "unit_price_bdt", "total_amount_bdt"]);
  });
});

describe("classifyRows", () => {
  it("marks complete rows GOOD and rows with blanks INCOMPLETE", () => {
    const result = classifyRows(
      [
        { ...full, id: "a" },
        { ...full, id: "b", sku: "SKU_B", vendorId: "" },
      ],
      [],
    );
    expect(result).toEqual([
      { id: "a", status: "GOOD", missing: [] },
      { id: "b", status: "INCOMPLETE", missing: ["vendor_id"] },
    ]);
  });

  it("flags later rows repeating a SKU, ignoring case and spaces", () => {
    const result = classifyRows(
      [
        { ...full, id: "a", sku: "SKU_A" },
        { ...full, id: "b", sku: " sku_a " },
      ],
      [],
    );
    expect(result[0]).toEqual({ id: "a", status: "GOOD", missing: [] });
    expect(result[1]).toEqual({ id: "b", status: "INCOMPLETE", missing: [DUPLICATE_SKU] });
  });

  it("flags a row whose SKU already exists as GOOD/STOCKED in the upload", () => {
    const result = classifyRows([{ ...full, id: "a", sku: "SKU_A" }], ["sku_a"]);
    expect(result).toEqual([{ id: "a", status: "INCOMPLETE", missing: [DUPLICATE_SKU] }]);
  });

  it("does not treat empty SKUs as duplicates of each other", () => {
    const result = classifyRows(
      [
        { ...full, id: "a", sku: "" },
        { ...full, id: "b", sku: "" },
      ],
      [],
    );
    expect(result.map((r) => r.missing)).toEqual([["sku"], ["sku"]]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `docker exec inventory-api sh -c "cd /app/apps/api && npx jest src/supplier-portal/etl.util.spec.ts"`
Expected: FAIL with `Cannot find module './etl.util'`.

- [ ] **Step 3: Write the implementation**

```ts
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

export function normalizeSku(sku: string): string {
  return sku.trim().toUpperCase();
}

/**
 * CSV column names whose value is empty. The CSV parser stores a missing
 * number as 0, so a non-positive quantity or price also counts as empty.
 */
export function findEmptyColumns(row: EtlRow): string[] {
  return ETL_COLUMNS.filter(({ key, kind }) => {
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
): Array<{ id: string; status: "GOOD" | "INCOMPLETE"; missing: string[] }> {
  const seen = new Set([...existingSkus].map(normalizeSku).filter(Boolean));
  return rows.map((row) => {
    const missing = findEmptyColumns(row);
    const sku = normalizeSku(row.sku);
    if (sku) {
      if (seen.has(sku)) missing.push(DUPLICATE_SKU);
      else seen.add(sku);
    }
    return { id: row.id, status: missing.length > 0 ? "INCOMPLETE" : "GOOD", missing };
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `docker exec inventory-api sh -c "cd /app/apps/api && npx jest src/supplier-portal/etl.util.spec.ts"`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/apps/api/src/supplier-portal/etl.util.ts backend/apps/api/src/supplier-portal/etl.util.spec.ts
git commit -m "feat(api): add supplier upload ETL row classification

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Derived upload status, and DRAFT for every upload

**Files:**
- Modify: `backend/apps/api/src/supplier-portal/upload-status.util.ts` (replace the whole file)
- Modify: `backend/apps/api/src/supplier-portal/upload-status.util.spec.ts` (replace the whole file)
- Modify: `backend/apps/api/src/supplier-portal/supplier-uploads.service.ts` (`createUpload` ~lines 89–187, `resubmit` ~lines 216–296)

**Interfaces:**
- Consumes: `SupplierItemEtlStatus` from Task 1.
- Produces:
  - `function deriveUploadStatus(statuses: SupplierItemEtlStatus[]): SupplierUploadStatus`
  - `async function syncUploadStatus(tx: Prisma.TransactionClient, uploadId: string): Promise<SupplierUploadStatus>`

- [ ] **Step 1: Write the failing test.** Replace `upload-status.util.spec.ts`:

```ts
import { SupplierItemEtlStatus as S, SupplierUploadStatus } from "@inv/database";
import { deriveUploadStatus } from "./upload-status.util";

describe("deriveUploadStatus", () => {
  it("keeps the upload PENDING while any row needs vendor work", () => {
    expect(deriveUploadStatus([S.NEW, S.STOCKED])).toBe(SupplierUploadStatus.PENDING);
    expect(deriveUploadStatus([S.GOOD, S.RETURNED])).toBe(SupplierUploadStatus.PENDING);
    expect(deriveUploadStatus([S.INCOMPLETE, S.STOCKED])).toBe(SupplierUploadStatus.PENDING);
  });

  it("is INCOMPLETE when only supplier-side rows remain", () => {
    expect(deriveUploadStatus([S.RETURNED, S.STOCKED])).toBe(SupplierUploadStatus.INCOMPLETE);
    expect(deriveUploadStatus([S.RETURNED])).toBe(SupplierUploadStatus.INCOMPLETE);
  });

  it("is ACCEPTED once every row is stocked", () => {
    expect(deriveUploadStatus([S.STOCKED, S.STOCKED])).toBe(SupplierUploadStatus.ACCEPTED);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `docker exec inventory-api sh -c "cd /app/apps/api && npx jest src/supplier-portal/upload-status.util.spec.ts"`
Expected: FAIL with `'"./upload-status.util"' has no exported member 'deriveUploadStatus'`.

- [ ] **Step 3: Write the implementation.** Replace `upload-status.util.ts`:

```ts
import { Prisma, SupplierItemEtlStatus, SupplierUploadStatus } from "@inv/database";

/**
 * Upload status for a submitted upload, derived from its rows. DRAFT and
 * REJECTED are set explicitly and never come from here.
 */
export function deriveUploadStatus(statuses: SupplierItemEtlStatus[]): SupplierUploadStatus {
  const vendorWork: SupplierItemEtlStatus[] = [
    SupplierItemEtlStatus.NEW,
    SupplierItemEtlStatus.GOOD,
    SupplierItemEtlStatus.INCOMPLETE,
  ];
  if (statuses.some((s) => vendorWork.includes(s))) return SupplierUploadStatus.PENDING;
  if (statuses.includes(SupplierItemEtlStatus.RETURNED)) return SupplierUploadStatus.INCOMPLETE;
  return SupplierUploadStatus.ACCEPTED;
}

export async function syncUploadStatus(
  tx: Prisma.TransactionClient,
  uploadId: string,
): Promise<SupplierUploadStatus> {
  const items = await tx.supplierUploadItem.findMany({
    where: { uploadId },
    select: { etlStatus: true },
  });
  const status = deriveUploadStatus(items.map((i) => i.etlStatus));
  await tx.supplierUpload.update({ where: { id: uploadId }, data: { status } });
  return status;
}
```

- [ ] **Step 4: Make `createUpload` always create a DRAFT.** In `supplier-uploads.service.ts`:
  - Delete the import line `import { initialUploadStatus } from "./upload-status.util";`.
  - Replace the block starting `const duplicateIssues = …` through `const uploadStatus = initialUploadStatus({ hasMissing, hasDuplicates });` with:

```ts
    const flaggedRows = new Set([
      ...missingFields.map((mf) => mf.row),
      ...issues.filter((i) => i.message.toLowerCase().includes("duplicate")).map((i) => i.row),
    ]).size;
```

  - In `tx.supplierUpload.create`, set `status: SupplierUploadStatus.DRAFT,`.
  - Replace the whole `if (hasMissing || hasDuplicates) { … } else { … }` notification block with:

```ts
      const autoNote =
        auto.autoFixed > 0
          ? ` ${auto.autoFixed} missing value(s) were auto-filled from the file data or product catalog.`
          : "";
      const flagNote =
        flaggedRows > 0
          ? ` ${flaggedRows} row(s) have empty or duplicate values; the vendor may send them back for correction.`
          : "";
      await tx.supplierNotification.create({
        data: {
          organizationId: supplier.organizationId,
          supplierUserId: supplier.id,
          uploadId: created.id,
          type: "UPLOAD_RECEIVED",
          message: `Your file "${input.fileName}" was uploaded as a draft.${autoNote}${flagNote} Review the parsed rows and submit it to the vendor when you are ready.`,
        },
      });
```

- [ ] **Step 5: Make `resubmit` (after a whole-file rejection) go straight to PENDING.** In `resubmit`:
  - Delete the lines `const hasMissing = missingFields.length > 0;` and `const uploadStatus = hasMissing ? … : …;`.
  - In `tx.supplierUpload.update`, change `status: uploadStatus,` to `status: SupplierUploadStatus.PENDING,`.
  - Delete the entire `if (hasMissing) { … }` notification block.
  - `createMany` rows get `etlStatus` `NEW` by default, so no change is needed there.

- [ ] **Step 6: Run the tests and the typecheck**

Run: `docker exec inventory-api sh -c "cd /app/apps/api && npx jest src/supplier-portal/upload-status.util.spec.ts && npx tsc -p tsconfig.json --noEmit"`
Expected: PASS, 3 tests, and no tsc output.

- [ ] **Step 7: Commit**

```bash
git add backend/apps/api/src/supplier-portal/upload-status.util.ts backend/apps/api/src/supplier-portal/upload-status.util.spec.ts backend/apps/api/src/supplier-portal/supplier-uploads.service.ts
git commit -m "feat(api): derive supplier upload status from row ETL states

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Validation schemas

**Files:**
- Modify: `backend/packages/validation/src/index.ts` (next to `rejectSupplierUploadSchema` ~line 436; types block ~line 480)
- Create: `backend/apps/api/src/supplier-portal/validation.spec.ts`

**Interfaces:**
- Produces:
  - `returnIncompleteSchema`: `{ note?: string }`, with type `ReturnIncompleteInput`
  - `incompleteItemEditSchema`: `{ id, poNumber, vendorId, vendorName, sku, itemDescription, category, orderDate, deliveryDate, status: string; orderQty, unitPriceBdt, totalAmountBdt: number }`
  - `resubmitIncompleteItemsSchema`: `{ items: IncompleteItemEdit[] }` (1–500 items, unique ids), with type `ResubmitIncompleteItemsInput`
  - Removes `fixSupplierUploadSchema` and `FixSupplierUploadInput`. **Task 6 removes their last uses**, so this step removes only the schema's definition and export after Task 6. To keep this task compiling, the deletion happens in Task 6, Step 6.

- [ ] **Step 1: Write the failing test**

```ts
import { resubmitIncompleteItemsSchema, returnIncompleteSchema } from "@inv/validation";

const row = {
  id: "cmueb0dqs0035oy219hss1esk",
  poNumber: "PO-1",
  vendorId: "",
  vendorName: "Aarong",
  sku: "SKU_A",
  itemDescription: "Milk",
  category: "Dairy",
  orderQty: 10,
  unitPriceBdt: 90,
  totalAmountBdt: 900,
  orderDate: "2026-07-15",
  deliveryDate: "2026-07-17",
  status: "Pending",
};

describe("returnIncompleteSchema", () => {
  it("accepts an empty body or a note", () => {
    expect(returnIncompleteSchema.parse({})).toEqual({});
    expect(returnIncompleteSchema.parse({ note: "Fill vendor ids" })).toEqual({ note: "Fill vendor ids" });
  });

  it("rejects notes over 2000 characters", () => {
    expect(() => returnIncompleteSchema.parse({ note: "x".repeat(2001) })).toThrow();
  });
});

describe("resubmitIncompleteItemsSchema", () => {
  it("accepts rows whose text fields are still empty (the service reports those per row)", () => {
    expect(resubmitIncompleteItemsSchema.parse({ items: [row] }).items[0].vendorId).toBe("");
  });

  it("requires at least one row and every column", () => {
    expect(() => resubmitIncompleteItemsSchema.parse({ items: [] })).toThrow();
    const { sku: _sku, ...withoutSku } = row;
    expect(() => resubmitIncompleteItemsSchema.parse({ items: [withoutSku] })).toThrow();
  });

  it("rejects the same row id twice", () => {
    expect(() => resubmitIncompleteItemsSchema.parse({ items: [row, row] })).toThrow(/duplicate/i);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `docker exec inventory-api sh -c "cd /app/apps/api && npx jest src/supplier-portal/validation.spec.ts"`
Expected: FAIL with `has no exported member 'resubmitIncompleteItemsSchema'`.

- [ ] **Step 3: Add the schemas** after `rejectSupplierUploadSchema` in `packages/validation/src/index.ts`:

```ts
export const returnIncompleteSchema = z.object({
  note: z.string().max(2000).optional(),
});

export const incompleteItemEditSchema = z.object({
  id: cuid,
  poNumber: z.string().max(100),
  vendorId: z.string().max(100),
  vendorName: z.string().max(200),
  sku: z.string().max(100),
  itemDescription: z.string().max(500),
  category: z.string().max(100),
  orderQty: z.number().int().nonnegative(),
  unitPriceBdt: z.number().nonnegative(),
  totalAmountBdt: z.number().nonnegative(),
  orderDate: z.string().max(40),
  deliveryDate: z.string().max(40),
  status: z.string().max(40),
});

export const resubmitIncompleteItemsSchema = z.object({
  items: z
    .array(incompleteItemEditSchema)
    .min(1)
    .max(500)
    .refine((items) => new Set(items.map((i) => i.id)).size === items.length, {
      message: "Duplicate row ids in resubmission",
    }),
});
```

and in the types block:

```ts
export type ReturnIncompleteInput = z.infer<typeof returnIncompleteSchema>;
export type IncompleteItemEdit = z.infer<typeof incompleteItemEditSchema>;
export type ResubmitIncompleteItemsInput = z.infer<typeof resubmitIncompleteItemsSchema>;
```

- [ ] **Step 4: Run the test, then rebuild the package**

Run: `docker exec inventory-api sh -c "cd /app/apps/api && npx jest src/supplier-portal/validation.spec.ts && cd /app/packages/validation && npx tsc -p tsconfig.json"`
Expected: PASS, 5 tests, and no tsc output.

- [ ] **Step 5: Commit**

```bash
git add backend/packages/validation/src/index.ts backend/apps/api/src/supplier-portal/validation.spec.ts
git commit -m "feat(validation): add schemas for returning and resubmitting incomplete rows

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Vendor API — run ETL, stock GOOD rows in batches, return incomplete rows, guard reject

**Files:**
- Modify: `backend/apps/api/src/supplier-portal/accept-selection.util.ts` + `accept-selection.util.spec.ts`
- Modify: `backend/apps/api/src/supplier-portal/supplier-portal.service.ts`
- Modify: `backend/apps/api/src/supplier-portal/supplier-portal.controller.ts`

**Interfaces:**
- Consumes: `classifyRows`, `normalizeSku` (Task 2); `syncUploadStatus` (Task 3); `returnIncompleteSchema`, `ReturnIncompleteInput` (Task 4); `SupplierItemEtlStatus` (Task 1).
- Produces:
  - `function selectGoodItems<T extends { id: string; etlStatus: SupplierItemEtlStatus }>(items: T[], itemIds: string[] | undefined): { selected: T[]; invalidIds: string[] }`
  - `POST /supplier-portal/manage/uploads/:id/etl` returns `{ good: number; incomplete: number; status: SupplierUploadStatus }`
  - `POST /supplier-portal/manage/uploads/:id/accept` returns `{ createdProducts: number; existingProducts: number; stockedCount: number; location: { id: string; name: string }; status: SupplierUploadStatus }`
  - `POST /supplier-portal/manage/uploads/:id/return-incomplete` returns `{ returned: number; status: SupplierUploadStatus }`
  - `GET /supplier-portal/manage/uploads/:id` items now include `etlStatus`, `stockedAt`, `stockedLocation: { id, name } | null`.

- [ ] **Step 1: Write the failing test.** In `accept-selection.util.spec.ts`, replace the import line and the whole `describe("filterAcceptItems", …)` block, and keep the `isFieldApplied` and `acceptSupplierUploadSchema` blocks:

```ts
import { SupplierItemEtlStatus as S } from "@inv/database";
import { acceptSupplierUploadSchema } from "@inv/validation";
import { isFieldApplied, selectGoodItems } from "./accept-selection.util";

describe("selectGoodItems", () => {
  const items = [
    { id: "a", etlStatus: S.GOOD },
    { id: "b", etlStatus: S.GOOD },
    { id: "c", etlStatus: S.STOCKED },
    { id: "d", etlStatus: S.INCOMPLETE },
  ];

  it("selects every GOOD row when no ids are given", () => {
    expect(selectGoodItems(items, undefined)).toEqual({
      selected: [items[0], items[1]],
      invalidIds: [],
    });
  });

  it("selects only the listed GOOD rows", () => {
    expect(selectGoodItems(items, ["b"])).toEqual({ selected: [items[1]], invalidIds: [] });
  });

  it("reports ids that are not GOOD or not in the upload", () => {
    expect(selectGoodItems(items, ["a", "c", "d", "zzz"]).invalidIds).toEqual(["c", "d", "zzz"]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `docker exec inventory-api sh -c "cd /app/apps/api && npx jest src/supplier-portal/accept-selection.util.spec.ts"`
Expected: FAIL with `has no exported member 'selectGoodItems'`.

- [ ] **Step 3: Replace `filterAcceptItems`** in `accept-selection.util.ts` (keep `isFieldApplied` and its import):

```ts
import { SupplierItemEtlStatus } from "@inv/database";

/**
 * Rows to stock: the listed ids (or every GOOD row when none are listed).
 * Any listed id that is not a GOOD row of this upload is reported so the
 * caller can reject the whole request.
 */
export function selectGoodItems<T extends { id: string; etlStatus: SupplierItemEtlStatus }>(
  items: T[],
  itemIds: string[] | undefined,
): { selected: T[]; invalidIds: string[] } {
  const good = items.filter((i) => i.etlStatus === SupplierItemEtlStatus.GOOD);
  if (!itemIds) return { selected: good, invalidIds: [] };
  const goodById = new Map(good.map((i) => [i.id, i]));
  return {
    selected: itemIds.flatMap((id) => (goodById.has(id) ? [goodById.get(id)!] : [])),
    invalidIds: itemIds.filter((id) => !goodById.has(id)),
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `docker exec inventory-api sh -c "cd /app/apps/api && npx jest src/supplier-portal/accept-selection.util.spec.ts"`
Expected: PASS, 8 tests.

- [ ] **Step 5: Update the service imports** in `supplier-portal.service.ts`:

```ts
import { Prisma, SupplierItemEtlStatus, SupplierUploadStatus } from "@inv/database";
```

```ts
import type {
  AcceptSupplierUploadInput,
  CreateSupplierUserInput,
  RejectSupplierUploadInput,
  ReturnIncompleteInput,
} from "@inv/validation";
```

```ts
import { isFieldApplied, selectGoodItems } from "./accept-selection.util";
import { classifyRows } from "./etl.util";
import { syncUploadStatus } from "./upload-status.util";
```

- [ ] **Step 6: Include the stocking location in `getUpload`.** Change `items: { orderBy: { id: "asc" } },` to:

```ts
        items: {
          orderBy: { id: "asc" },
          include: { stockedLocation: { select: { id: true, name: true } } },
        },
```

- [ ] **Step 7: Add `runEtl`** directly above `acceptUpload`:

```ts
  /** Classify NEW rows into GOOD / INCOMPLETE. Rows already classified are untouched. */
  async runEtl(organizationId: string, id: string, actor: AuthUser) {
    const upload = await this.assertOrgUpload(organizationId, id);
    if (upload.status !== SupplierUploadStatus.PENDING) {
      throw invalidOperation("ETL can only run on uploads waiting for vendor review");
    }

    return this.prisma.$transaction(async (tx) => {
      const items = await tx.supplierUploadItem.findMany({
        where: { uploadId: upload.id },
        orderBy: { id: "asc" },
      });
      const fresh = items.filter((i) => i.etlStatus === SupplierItemEtlStatus.NEW);
      if (fresh.length === 0) throw invalidOperation("There are no new rows to process");

      const existingSkus = items
        .filter(
          (i) =>
            i.etlStatus === SupplierItemEtlStatus.GOOD ||
            i.etlStatus === SupplierItemEtlStatus.STOCKED,
        )
        .map((i) => i.sku);
      const results = classifyRows(fresh, existingSkus);

      for (const r of results) {
        await tx.supplierUploadItem.update({
          where: { id: r.id },
          data: {
            etlStatus:
              r.status === "GOOD" ? SupplierItemEtlStatus.GOOD : SupplierItemEtlStatus.INCOMPLETE,
            missingFields: r.missing,
          },
        });
      }
      const status = await syncUploadStatus(tx, upload.id);
      const good = results.filter((r) => r.status === "GOOD").length;
      const incomplete = results.length - good;

      await this.audit.log(tx, {
        organizationId,
        userId: actor.id,
        action: "SUPPLIER_UPLOAD_ETL_RUN",
        entity: "SupplierUpload",
        entityId: upload.id,
        newValue: { good, incomplete },
      });
      return { good, incomplete, status };
    });
  }
```

- [ ] **Step 8: Rewrite the body of `acceptUpload`** (keep its signature and doc comment, but change the comment's first line to `Stock GOOD rows into a location. Can be repeated per location.`). Replace everything from `const upload = await this.assertOrgUpload(` through the final `return result;` with:

```ts
    const upload = await this.assertOrgUpload(organizationId, id);
    if (upload.status !== SupplierUploadStatus.PENDING) {
      throw invalidOperation("Only uploads waiting for vendor review can be stocked");
    }
    const location = await this.tenant.assertLocation(organizationId, input.locationId);

    const result = await this.prisma.$transaction(async (tx) => {
      const items = await tx.supplierUploadItem.findMany({ where: { uploadId: upload.id } });
      const { selected, invalidIds } = selectGoodItems(items, input.itemIds);
      if (invalidIds.length > 0) {
        throw invalidOperation(
          `${invalidIds.length} selected row(s) are no longer ready to stock. Refresh the page and try again.`,
        );
      }
      if (selected.length === 0) throw invalidOperation("There are no good rows to stock");

      let createdProducts = 0;
      let existingProducts = 0;
      const now = new Date();

      for (const item of selected) {
        const category = isFieldApplied(input.fields, "category")
          ? await this.findOrCreateCategory(tx, organizationId, item.category)
          : null;
        let product = await tx.product.findFirst({
          where: { organizationId, sku: item.sku },
        });
        if (product) {
          existingProducts++;
          // Unchecked columns leave the existing catalog values untouched.
          product = await tx.product.update({
            where: { id: product.id },
            data: {
              ...(isFieldApplied(input.fields, "itemDescription")
                ? { name: item.itemDescription || product.name }
                : {}),
              ...(category ? { categoryId: category.id } : {}),
              ...(isFieldApplied(input.fields, "unitPriceBdt")
                ? { costPrice: item.unitPriceBdt }
                : {}),
            },
          });
        } else {
          createdProducts++;
          product = await tx.product.create({
            data: {
              organizationId,
              sku: item.sku,
              name: item.itemDescription || item.sku,
              categoryId: category?.id ?? null,
              unit: "pcs",
              costPrice: item.unitPriceBdt,
              sellingPrice: item.unitPriceBdt,
              reorderLevel: 0,
            },
          });
        }

        await this.engine.applyMovement({
          db: tx,
          organizationId,
          productId: product.id,
          locationId: input.locationId,
          type: "PURCHASE",
          quantity: item.orderQty,
          referenceType: "SupplierUpload",
          referenceId: upload.id,
          metadata: {
            fileName: upload.originalName,
            supplierName: upload.supplierUser.email,
            poNumber: item.poNumber,
          },
          createdById: actor.id,
        });

        await tx.supplierUploadItem.update({
          where: { id: item.id },
          data: {
            etlStatus: SupplierItemEtlStatus.STOCKED,
            stockedLocationId: location.id,
            stockedAt: now,
          },
        });
      }

      await tx.supplierUpload.update({
        where: { id: upload.id },
        data: {
          locationId: location.id,
          acceptedById: upload.acceptedById ?? actor.id,
          acceptedAt: upload.acceptedAt ?? now,
        },
      });
      const status = await syncUploadStatus(tx, upload.id);

      await tx.supplierNotification.create({
        data: {
          organizationId,
          uploadId: upload.id,
          supplierUserId: upload.supplierUserId,
          type: "ACCEPTED",
          message: `${selected.length} product(s) from "${upload.originalName}" were added to ${location.name}.`,
        },
      });

      await this.audit.log(tx, {
        organizationId,
        userId: actor.id,
        action: "SUPPLIER_UPLOAD_STOCKED",
        entity: "SupplierUpload",
        entityId: upload.id,
        oldValue: { status: upload.status },
        newValue: { status, location: location.name, rows: selected.length },
      });

      return {
        createdProducts,
        existingProducts,
        stockedCount: selected.length,
        location: { id: location.id, name: location.name },
        status,
      };
    });

    // Asynchronously trigger ML demand forecast & shortage retraining
    this.ai.runPipeline().catch((err) => {
      // Non-blocking: log pipeline trigger status if ML service is offline
      console.warn("Auto-trigger ML pipeline after supplier upload acceptance:", err?.message || err);
    });

    return result;
```

- [ ] **Step 9: Add `returnIncomplete`** directly below `acceptUpload`:

```ts
  /** Send every INCOMPLETE row back to the supplier with an optional note. */
  async returnIncomplete(
    organizationId: string,
    id: string,
    input: ReturnIncompleteInput,
    actor: AuthUser,
  ) {
    const upload = await this.assertOrgUpload(organizationId, id);
    if (upload.status !== SupplierUploadStatus.PENDING) {
      throw invalidOperation("Only uploads waiting for vendor review can return rows");
    }
    const note = input.note?.trim() || null;

    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.supplierUploadItem.updateMany({
        where: { uploadId: upload.id, etlStatus: SupplierItemEtlStatus.INCOMPLETE },
        data: { etlStatus: SupplierItemEtlStatus.RETURNED },
      });
      if (count === 0) throw invalidOperation("There are no incomplete rows to send back");

      await tx.supplierUpload.update({ where: { id: upload.id }, data: { vendorNote: note } });
      const status = await syncUploadStatus(tx, upload.id);

      await tx.supplierNotification.create({
        data: {
          organizationId,
          uploadId: upload.id,
          supplierUserId: upload.supplierUserId,
          type: "REJECTED",
          message: `${count} row(s) from "${upload.originalName}" have empty or duplicate values and need your correction.${note ? ` Vendor note: ${note}` : ""} Fix them on the Incomplete data page.`,
        },
      });

      await this.audit.log(tx, {
        organizationId,
        userId: actor.id,
        action: "SUPPLIER_UPLOAD_ROWS_RETURNED",
        entity: "SupplierUpload",
        entityId: upload.id,
        newValue: { returned: count, note },
      });
      return { returned: count, status };
    });
  }
```

- [ ] **Step 10: Guard the whole-file reject.** In `rejectUpload`, directly after the existing `if (upload.status === SupplierUploadStatus.ACCEPTED) { … }` block, add:

```ts
    const stocked = await this.prisma.supplierUploadItem.count({
      where: { uploadId: upload.id, etlStatus: SupplierItemEtlStatus.STOCKED },
    });
    if (stocked > 0) {
      throw invalidOperation(
        "Rows from this upload are already in stock. Send the incomplete rows back instead of rejecting the file.",
      );
    }
```

- [ ] **Step 11: Add the controller routes.** In `supplier-portal.controller.ts`, add `returnIncompleteSchema` to the value import from `@inv/validation` and `ReturnIncompleteInput` to the type import. Then add these routes after the `accept` route:

```ts
  @Post("uploads/:id/etl")
  @RequirePermission("supplier-uploads.manage")
  etl(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    return this.portal.runEtl(user.organizationId!, id, user);
  }

  @Post("uploads/:id/return-incomplete")
  @RequirePermission("supplier-uploads.manage")
  returnIncomplete(
    @Param("id") id: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(returnIncompleteSchema)) body: ReturnIncompleteInput,
  ) {
    return this.portal.returnIncomplete(user.organizationId!, id, body, user);
  }
```

- [ ] **Step 12: Run the typecheck and the full suite**

Run: `docker exec inventory-api sh -c "cd /app/apps/api && npx tsc -p tsconfig.json --noEmit && npx jest"`
Expected: no tsc output; all suites pass.

- [ ] **Step 13: Commit**

```bash
git add backend/apps/api/src/supplier-portal/accept-selection.util.ts backend/apps/api/src/supplier-portal/accept-selection.util.spec.ts backend/apps/api/src/supplier-portal/supplier-portal.service.ts backend/apps/api/src/supplier-portal/supplier-portal.controller.ts
git commit -m "feat(api): vendor ETL run, batch stocking of good rows, return incomplete rows

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Supplier API — list and resubmit incomplete rows, profile count, retire the fix flow

**Files:**
- Modify: `backend/apps/api/src/supplier-portal/supplier-uploads.service.ts`
- Modify: `backend/apps/api/src/supplier-portal/supplier-uploads.controller.ts`
- Modify: `backend/packages/validation/src/index.ts` (delete `fixSupplierUploadSchema` and `FixSupplierUploadInput`)

**Interfaces:**
- Consumes: `findEmptyColumns` (Task 2); `syncUploadStatus` (Task 3); `resubmitIncompleteItemsSchema`, `ResubmitIncompleteItemsInput` (Task 4).
- Produces:
  - `GET /supplier-portal/incomplete-items` returns an array of `SupplierUploadItem & { upload: { id, originalName, vendorNote, createdAt } }` (RETURNED rows only).
  - `POST /supplier-portal/incomplete-items/resubmit` returns `{ resubmitted: number; uploads: number }`. On failure it returns 400 `VALIDATION_ERROR` with `details: { rows: Array<{ id: string; fields: string[] }> }`, or 409 `INVALID_OPERATION` if any id is not a RETURNED row of this supplier.
  - `GET /supplier-portal/me` → `report.returnedItems: number`.

- [ ] **Step 1: Update the imports** in `supplier-uploads.service.ts`:

```ts
import { SupplierItemEtlStatus, SupplierUploadStatus } from "@inv/database";
import { PrismaService } from "../prisma/prisma.service";
import { DomainException, ErrorCodes, invalidOperation, notFound } from "../common/errors";
import { parseShipmentCsv, type ParsedShipmentRow, type RowIssue } from "./csv";
import { findEmptyColumns } from "./etl.util";
import { syncUploadStatus } from "./upload-status.util";
import type {
  ResubmitIncompleteItemsInput,
  ResubmitWithEditsInput,
  SupplierUploadInput,
} from "@inv/validation";
```

(`FixSupplierUploadInput` is dropped. Check that `DomainException` and `ErrorCodes` are exported from `../common/errors`; both are declared with `export` at lines 1 and 19 of that file.)

- [ ] **Step 2: Add `returnedItems` to `profile`.** Replace the `Promise.all` at the top of `profile` with:

```ts
    const [uploads, unread, returnedItems] = await Promise.all([
      this.prisma.supplierUpload.count({ where: { supplierUserId: supplier.id } }),
      this.prisma.supplierNotification.count({ where: { supplierUserId: supplier.id, readAt: null } }),
      this.prisma.supplierUploadItem.count({
        where: { etlStatus: SupplierItemEtlStatus.RETURNED, upload: { supplierUserId: supplier.id } },
      }),
    ]);
```

and add `returnedItems,` inside the returned `report: { … }` object after `unreadNotifications: unread,`.

- [ ] **Step 3: Delete `fixItems`** (the whole method and its doc comment, "Supplier fixes missing fields on an INCOMPLETE upload").

- [ ] **Step 4: Add the two new methods** in its place:

```ts
  /** Every row the vendor sent back to this supplier, across all uploads. */
  async listIncompleteItems(supplier: SupplierAuthUser) {
    return this.prisma.supplierUploadItem.findMany({
      where: { etlStatus: SupplierItemEtlStatus.RETURNED, upload: { supplierUserId: supplier.id } },
      include: {
        upload: { select: { id: true, originalName: true, vendorNote: true, createdAt: true } },
      },
      orderBy: [{ upload: { createdAt: "asc" } }, { id: "asc" }],
    });
  }

  /**
   * Supplier corrects returned rows. All-or-nothing: every row must be a
   * RETURNED row of this supplier and have no empty columns. Accepted rows go
   * back to NEW in their original upload for the vendor to run ETL again.
   */
  async resubmitIncompleteItems(supplier: SupplierAuthUser, input: ResubmitIncompleteItemsInput) {
    const ids = input.items.map((i) => i.id);
    const owned = await this.prisma.supplierUploadItem.findMany({
      where: {
        id: { in: ids },
        etlStatus: SupplierItemEtlStatus.RETURNED,
        upload: { supplierUserId: supplier.id },
      },
      select: { id: true, uploadId: true },
    });
    if (owned.length !== ids.length) {
      throw invalidOperation(
        "Some rows are no longer waiting for your correction. Refresh the page and try again.",
      );
    }

    const failures = input.items
      .map((item) => ({ id: item.id, fields: findEmptyColumns(item) }))
      .filter((f) => f.fields.length > 0);
    if (failures.length > 0) {
      throw new DomainException(
        ErrorCodes.VALIDATION_ERROR,
        `${failures.length} row(s) still have empty values`,
        400,
        { rows: failures },
      );
    }

    const uploadIds = [...new Set(owned.map((o) => o.uploadId))];
    await this.prisma.$transaction(async (tx) => {
      for (const { id, ...fields } of input.items) {
        await tx.supplierUploadItem.update({
          where: { id },
          data: { ...fields, etlStatus: SupplierItemEtlStatus.NEW, missingFields: [] },
        });
      }
      for (const uploadId of uploadIds) {
        const upload = await tx.supplierUpload.update({
          where: { id: uploadId },
          data: { submissionCount: { increment: 1 } },
          select: { originalName: true },
        });
        await syncUploadStatus(tx, uploadId);
        await tx.supplierNotification.updateMany({
          where: { uploadId, readAt: null },
          data: { readAt: new Date(), resolvedAt: new Date() },
        });
        const count = owned.filter((o) => o.uploadId === uploadId).length;
        await tx.supplierNotification.create({
          data: {
            organizationId: supplier.organizationId,
            supplierUserId: supplier.id,
            uploadId,
            type: "UPLOAD_RECEIVED",
            message: `${count} corrected row(s) from "${upload.originalName}" were sent back to the vendor for review.`,
          },
        });
      }
    });

    return { resubmitted: input.items.length, uploads: uploadIds.length };
  }
```

- [ ] **Step 5: Update the controller.** In `supplier-uploads.controller.ts`:
  - Delete the `@Post("uploads/:id/fix")` route.
  - In the imports from `@inv/validation`, remove `fixSupplierUploadSchema` / `FixSupplierUploadInput` and add `resubmitIncompleteItemsSchema` / `ResubmitIncompleteItemsInput`.
  - Add these routes after the `resubmitEdits` route:

```ts
  @Get("incomplete-items")
  incompleteItems(@CurrentSupplier() supplier: SupplierAuthUser) {
    return this.uploads.listIncompleteItems(supplier);
  }

  @Post("incomplete-items/resubmit")
  resubmitIncomplete(
    @CurrentSupplier() supplier: SupplierAuthUser,
    @Body(new ZodValidationPipe(resubmitIncompleteItemsSchema)) body: ResubmitIncompleteItemsInput,
  ) {
    return this.uploads.resubmitIncompleteItems(supplier, body);
  }
```

- [ ] **Step 6: Delete the fix schema.** In `packages/validation/src/index.ts`, delete the `export const fixSupplierUploadSchema = …;` block and the `export type FixSupplierUploadInput = …;` line.

Run: `grep -rn "fixSupplierUploadSchema\|FixSupplierUploadInput\|fixItems" /Volumes/work/personal/pos/backend/apps/api/src /Volumes/work/personal/pos/backend/packages/validation/src`
Expected: no output.

- [ ] **Step 7: Rebuild validation, typecheck, run the full suite, and restart the API**

Run: `docker exec inventory-api sh -c "cd /app/packages/validation && npx tsc -p tsconfig.json && cd /app/apps/api && npx tsc -p tsconfig.json --noEmit && npx jest" && docker restart inventory-api && sleep 20 && docker logs inventory-api 2>&1 | grep -E "incomplete-items|uploads/:id/etl|return-incomplete"`
Expected: all suites pass, and 4 `Mapped {…}` lines appear for `/incomplete-items GET`, `/incomplete-items/resubmit POST`, `/manage/uploads/:id/etl POST`, and `/manage/uploads/:id/return-incomplete POST`.

- [ ] **Step 8: Commit**

```bash
git add backend/apps/api/src/supplier-portal/supplier-uploads.service.ts backend/apps/api/src/supplier-portal/supplier-uploads.controller.ts backend/packages/validation/src/index.ts
git commit -m "feat(api): supplier incomplete-rows list and resubmit; retire fix flow

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Vendor page — Run ETL, filter tabs, batch stocking, return rows

**Files:**
- Rewrite: `frontend/app/(app)/supplier-uploads/[id]/page.tsx`

**Interfaces:**
- Consumes: the endpoints from Task 5; `apiFetch` from `@/lib/api`; UI kit from `@/components/ui` (`Badge` colors: `zinc | green | red | amber | blue | indigo`).

- [ ] **Step 1: Replace the file with:**

```tsx
"use client";

import Link from "next/link";
import { use, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Empty,
  Loading,
  PageHeader,
  Select,
  Textarea,
  formatMoney,
} from "@/components/ui";

type EtlStatus = "NEW" | "GOOD" | "INCOMPLETE" | "RETURNED" | "STOCKED";
type BadgeColor = "zinc" | "green" | "red" | "amber" | "blue" | "indigo";

interface UploadItem {
  id: string;
  poNumber: string;
  vendorId: string;
  vendorName: string;
  sku: string;
  itemDescription: string;
  category: string;
  orderQty: number;
  unitPriceBdt: number | string;
  totalAmountBdt: number | string;
  orderDate: string | null;
  deliveryDate: string | null;
  status: string | null;
  missingFields: string[] | null;
  etlStatus: EtlStatus;
  stockedAt: string | null;
  stockedLocation: { id: string; name: string } | null;
}

interface UploadDetail {
  id: string;
  originalName: string;
  status: string;
  rowCount: number;
  submissionCount: number;
  vendorNote: string | null;
  createdAt: string;
  supplierUser: { id: string; name: string; email: string; phone: string | null };
  items: UploadItem[];
}

interface Store {
  id: string;
  name: string;
  code: string;
  type: string;
}

interface StockResult {
  createdProducts: number;
  existingProducts: number;
  stockedCount: number;
  location: { id: string; name: string };
}

const TABS: EtlStatus[] = ["NEW", "GOOD", "INCOMPLETE", "RETURNED", "STOCKED"];
const TAB_LABELS: Record<EtlStatus, string> = {
  NEW: "New",
  GOOD: "Good",
  INCOMPLETE: "Incomplete",
  RETURNED: "Returned to supplier",
  STOCKED: "Stocked",
};
const TAB_COLORS: Record<EtlStatus, BadgeColor> = {
  NEW: "zinc",
  GOOD: "green",
  INCOMPLETE: "amber",
  RETURNED: "blue",
  STOCKED: "indigo",
};

const OPTIONAL_FIELDS = ["itemDescription", "category", "unitPriceBdt"] as const;
type AcceptField = (typeof OPTIONAL_FIELDS)[number];

interface Column {
  column: string;
  label: string;
  align?: "right";
  field?: AcceptField;
  render: (item: UploadItem) => React.ReactNode;
}

const text = (v: string | null) => (v && v.trim() ? v : null);

const COLUMNS: Column[] = [
  { column: "po_number", label: "PO #", render: (i) => text(i.poNumber) },
  { column: "vendor_id", label: "Vendor ID", render: (i) => text(i.vendorId) },
  { column: "vendor_name", label: "Vendor", render: (i) => text(i.vendorName) },
  { column: "sku", label: "SKU", render: (i) => text(i.sku) && <span className="font-mono text-xs">{i.sku}</span> },
  { column: "item_description", label: "Description", field: "itemDescription", render: (i) => text(i.itemDescription) },
  { column: "category", label: "Category", field: "category", render: (i) => text(i.category) },
  { column: "order_qty", label: "Qty", align: "right", render: (i) => (i.orderQty > 0 ? i.orderQty.toLocaleString() : null) },
  { column: "unit_price_bdt", label: "Unit price", align: "right", field: "unitPriceBdt", render: (i) => (Number(i.unitPriceBdt) > 0 ? formatMoney(i.unitPriceBdt) : null) },
  { column: "total_amount_bdt", label: "Total", align: "right", render: (i) => (Number(i.totalAmountBdt) > 0 ? formatMoney(i.totalAmountBdt) : null) },
  { column: "order_date", label: "Order date", render: (i) => text(i.orderDate) },
  { column: "delivery_date", label: "Delivery", render: (i) => text(i.deliveryDate) },
  { column: "status", label: "Status", render: (i) => text(i.status) },
];

const TH = "whitespace-nowrap px-3 py-3 text-left text-[10px] font-bold uppercase tracking-[0.1em] text-zinc-500";

function isFlagged(item: UploadItem, column: string) {
  const missing = item.missingFields ?? [];
  return missing.includes(column) || (column === "sku" && missing.includes("duplicate_sku"));
}

export default function VendorUploadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const queryClient = useQueryClient();
  const { id } = use(params);

  const { data: upload, isLoading } = useQuery({
    queryKey: ["manage-supplier-upload", id],
    queryFn: () => apiFetch<UploadDetail>(`/supplier-portal/manage/uploads/${id}`),
    enabled: !!id,
  });
  const { data: stores } = useQuery({
    queryKey: ["stores"],
    queryFn: () => apiFetch<Store[]>("/stores"),
  });

  const [tab, setTab] = useState<EtlStatus | null>(null);
  const [locationId, setLocationId] = useState("");
  const [deselectedIds, setDeselectedIds] = useState<Set<string>>(new Set());
  const [excludedFields, setExcludedFields] = useState<Set<AcceptField>>(new Set());
  const [returnNote, setReturnNote] = useState("");
  const [rejectNote, setRejectNote] = useState("");
  const [etlResult, setEtlResult] = useState<{ good: number; incomplete: number } | null>(null);
  const [stockResult, setStockResult] = useState<StockResult | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["manage-supplier-upload", id] });
    queryClient.invalidateQueries({ queryKey: ["manage-supplier-uploads"] });
    setDeselectedIds(new Set());
    setActionError(null);
  };
  const onError = (err: unknown) => setActionError(err instanceof Error ? err.message : "Action failed");

  const etlMutation = useMutation({
    mutationFn: () =>
      apiFetch<{ good: number; incomplete: number }>(`/supplier-portal/manage/uploads/${id}/etl`, {
        method: "POST",
      }),
    onSuccess: (data) => {
      setEtlResult(data);
      setTab(data.good > 0 ? "GOOD" : "INCOMPLETE");
      refresh();
    },
    onError,
  });

  const stockMutation = useMutation({
    mutationFn: (body: { locationId: string; itemIds: string[]; fields?: AcceptField[] }) =>
      apiFetch<StockResult>(`/supplier-portal/manage/uploads/${id}/accept`, { method: "POST", body }),
    onSuccess: (data) => {
      setStockResult(data);
      refresh();
    },
    onError,
  });

  const returnMutation = useMutation({
    mutationFn: (note: string) =>
      apiFetch<{ returned: number }>(`/supplier-portal/manage/uploads/${id}/return-incomplete`, {
        method: "POST",
        body: note.trim() ? { note: note.trim() } : {},
      }),
    onSuccess: () => {
      setReturnNote("");
      refresh();
    },
    onError,
  });

  const rejectMutation = useMutation({
    mutationFn: (note: string) =>
      apiFetch(`/supplier-portal/manage/uploads/${id}/reject`, { method: "POST", body: { note } }),
    onSuccess: () => {
      setRejectNote("");
      refresh();
    },
    onError,
  });

  const counts = useMemo(() => {
    const c: Record<EtlStatus, number> = { NEW: 0, GOOD: 0, INCOMPLETE: 0, RETURNED: 0, STOCKED: 0 };
    for (const item of upload?.items ?? []) c[item.etlStatus]++;
    return c;
  }, [upload]);

  if (isLoading || !id) return <Loading />;
  if (!upload) return <Empty label="Upload not found" />;

  const activeTab: EtlStatus = tab ?? TABS.find((t) => counts[t] > 0) ?? "NEW";
  const rows = upload.items.filter((i) => i.etlStatus === activeTab);
  const isPending = upload.status === "PENDING";
  const selectable = isPending && activeTab === "GOOD";
  const selectedGood = rows.filter((i) => !deselectedIds.has(i.id));
  const allSelected = selectable && selectedGood.length === rows.length;
  const statusColor: BadgeColor =
    upload.status === "ACCEPTED" ? "green" : upload.status === "REJECTED" ? "red" : upload.status === "INCOMPLETE" ? "amber" : "indigo";

  const toggle = <T,>(set: Set<T>, value: T) => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    return next;
  };

  const handleStock = () => {
    const fields = OPTIONAL_FIELDS.filter((f) => !excludedFields.has(f));
    stockMutation.mutate({
      locationId,
      itemIds: selectedGood.map((i) => i.id),
      ...(fields.length < OPTIONAL_FIELDS.length ? { fields } : {}),
    });
  };

  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow="Supplier upload review"
        title={upload.originalName}
        description={`From ${upload.supplierUser.name} · Submitted ${new Date(upload.createdAt).toLocaleString()} · ${upload.items.length} rows · Attempt #${upload.submissionCount}`}
        actions={
          <div className="flex gap-2">
            <Badge color={statusColor}>{upload.status}</Badge>
            <Link
              href="/supplier-uploads"
              className="inline-flex min-h-10 items-center justify-center rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-semibold text-zinc-700 shadow-sm hover:border-zinc-400 hover:bg-zinc-50"
            >
              Back to queue
            </Link>
          </div>
        }
      />

      {actionError && (
        <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{actionError}</p>
      )}

      {/* ETL */}
      {isPending && counts.NEW > 0 && (
        <Card className="border-teal-200">
          <CardHeader className="pb-2">
            <CardTitle>Run ETL</CardTitle>
            <p className="text-xs text-zinc-500">
              Checks the {counts.NEW} new row(s) for empty values and duplicate SKUs, and separates
              good rows from incomplete ones. Rows already processed are not touched.
            </p>
          </CardHeader>
          <CardContent>
            <Button onClick={() => etlMutation.mutate()} disabled={etlMutation.isPending}>
              {etlMutation.isPending ? "Running ETL..." : "Run ETL"}
            </Button>
          </CardContent>
        </Card>
      )}
      {etlResult && (
        <p className="rounded-lg border border-teal-200 bg-teal-50 p-3 text-sm text-teal-800">
          ETL complete: <span className="font-semibold">{etlResult.good} good</span> ·{" "}
          <span className="font-semibold">{etlResult.incomplete} incomplete</span>
        </p>
      )}

      {stockResult && (
        <Card className="border-emerald-200 bg-emerald-50/50">
          <CardContent className="pt-6">
            <p className="text-sm text-emerald-800">
              Added <span className="font-semibold">{stockResult.stockedCount}</span> row(s) to{" "}
              <span className="font-semibold">{stockResult.location.name}</span> ·{" "}
              {stockResult.createdProducts} new product(s), {stockResult.existingProducts} updated.
            </p>
            <p className="mt-2 text-xs text-emerald-700">
              AI forecasting has been triggered to retrain with the new stock.{" "}
              <Link href="/ai-insights" className="font-semibold underline">View AI Insights</Link>
            </p>
          </CardContent>
        </Card>
      )}

      {/* Items */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap gap-2">
            {TABS.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => { setTab(t); setDeselectedIds(new Set()); }}
                className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-medium ${
                  activeTab === t ? "border-teal-600 bg-teal-50 text-teal-800" : "border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50"
                }`}
              >
                {TAB_LABELS[t]}
                <Badge color={TAB_COLORS[t]}>{counts[t]}</Badge>
              </button>
            ))}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {selectable && rows.length > 0 && (
            <div className="grid gap-3 rounded-lg border border-emerald-200 bg-emerald-50/40 p-4 sm:grid-cols-[1fr_auto] sm:items-end">
              <label className="grid gap-2 text-sm font-semibold text-zinc-700">
                Add selected good rows to store or warehouse
                <Select value={locationId} onChange={(e) => setLocationId(e.target.value)}>
                  <option value="">Choose a location...</option>
                  {stores?.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.type === "WAREHOUSE" ? "Warehouse" : "Store"})
                    </option>
                  ))}
                </Select>
              </label>
              <Button
                disabled={!locationId || selectedGood.length === 0 || stockMutation.isPending}
                onClick={handleStock}
              >
                {stockMutation.isPending ? "Adding to stock..." : `Add ${selectedGood.length} row(s) to stock`}
              </Button>
              {excludedFields.size > 0 && (
                <p className="text-xs text-amber-700 sm:col-span-2">
                  Unchecked columns are not written; existing products keep their current values.
                </p>
              )}
            </div>
          )}

          {isPending && activeTab === "INCOMPLETE" && rows.length > 0 && (
            <div className="grid gap-3 rounded-lg border border-amber-200 bg-amber-50/40 p-4">
              <label className="grid gap-2 text-sm font-semibold text-zinc-700">
                Note to supplier (optional)
                <Textarea
                  rows={3}
                  value={returnNote}
                  onChange={(e) => setReturnNote(e.target.value)}
                  placeholder="e.g. Please fill in the vendor ID and delivery date for these rows."
                />
              </label>
              <Button onClick={() => returnMutation.mutate(returnNote)} disabled={returnMutation.isPending}>
                {returnMutation.isPending ? "Sending..." : `Send ${rows.length} incomplete row(s) to supplier`}
              </Button>
            </div>
          )}

          {rows.length > 0 ? (
            <div className="w-full overflow-x-auto rounded-lg border border-zinc-200">
              <table className="w-full text-sm">
                <thead className="border-b border-zinc-200 bg-zinc-50/80">
                  <tr>
                    {selectable && (
                      <th className="px-3 py-3">
                        <input
                          type="checkbox"
                          aria-label="Select all good rows"
                          className="h-4 w-4 accent-teal-600"
                          checked={allSelected}
                          ref={(el) => {
                            if (el) el.indeterminate = selectedGood.length > 0 && !allSelected;
                          }}
                          onChange={() =>
                            setDeselectedIds(allSelected ? new Set(rows.map((i) => i.id)) : new Set())
                          }
                        />
                      </th>
                    )}
                    {COLUMNS.map((c) => (
                      <th key={c.column} className={`${TH} ${c.align === "right" ? "text-right" : ""}`}>
                        <span className="inline-flex items-center gap-1.5">
                          {selectable && c.field && (
                            <input
                              type="checkbox"
                              aria-label={`Import ${c.label} column`}
                              className="h-3.5 w-3.5 accent-teal-600"
                              checked={!excludedFields.has(c.field)}
                              onChange={() => setExcludedFields((s) => toggle(s, c.field!))}
                            />
                          )}
                          {c.label}
                        </span>
                      </th>
                    ))}
                    {activeTab === "STOCKED" && (
                      <>
                        <th className={TH}>Store</th>
                        <th className={TH}>Stocked at</th>
                      </>
                    )}
                    {(activeTab === "INCOMPLETE" || activeTab === "RETURNED") && <th className={TH}>Problems</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 bg-white">
                  {rows.map((item) => {
                    const off = selectable && deselectedIds.has(item.id);
                    return (
                      <tr key={item.id} className={`hover:bg-teal-50/30 ${off ? "opacity-40" : ""}`}>
                        {selectable && (
                          <td className="px-3 py-2">
                            <input
                              type="checkbox"
                              aria-label={`Select row ${item.sku}`}
                              className="h-4 w-4 accent-teal-600"
                              checked={!deselectedIds.has(item.id)}
                              onChange={() => setDeselectedIds((s) => toggle(s, item.id))}
                            />
                          </td>
                        )}
                        {COLUMNS.map((c) => {
                          const value = c.render(item);
                          const flagged = isFlagged(item, c.column);
                          const dimmed = selectable && c.field && excludedFields.has(c.field);
                          return (
                            <td
                              key={c.column}
                              className={`whitespace-nowrap px-3 py-2 text-zinc-700 ${c.align === "right" ? "text-right tabular-nums" : ""} ${
                                flagged ? "bg-red-50 ring-1 ring-inset ring-red-300" : ""
                              } ${dimmed ? "opacity-40" : ""}`}
                            >
                              {value ?? <span className="text-xs italic text-red-500">empty</span>}
                            </td>
                          );
                        })}
                        {activeTab === "STOCKED" && (
                          <>
                            <td className="whitespace-nowrap px-3 py-2 text-zinc-700">{item.stockedLocation?.name ?? "—"}</td>
                            <td className="whitespace-nowrap px-3 py-2 text-zinc-500">
                              {item.stockedAt ? new Date(item.stockedAt).toLocaleString() : "—"}
                            </td>
                          </>
                        )}
                        {(activeTab === "INCOMPLETE" || activeTab === "RETURNED") && (
                          <td className="px-3 py-2">
                            <span className="inline-flex flex-wrap gap-1">
                              {(item.missingFields ?? []).map((f) => (
                                <span key={f} className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
                                  {f.replace(/_/g, " ")}
                                </span>
                              ))}
                            </span>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty label={`No ${TAB_LABELS[activeTab].toLowerCase()} rows`} />
          )}
        </CardContent>
      </Card>

      {/* Whole-file reject — only before anything is stocked */}
      {isPending && counts.STOCKED === 0 && (
        <Card className="border-red-200">
          <CardHeader className="pb-2">
            <CardTitle className="text-red-800">Reject the whole file</CardTitle>
            <p className="text-xs text-red-700">The supplier will see your note and resubmit a corrected file.</p>
          </CardHeader>
          <CardContent className="space-y-3">
            <Textarea rows={3} value={rejectNote} onChange={(e) => setRejectNote(e.target.value)} placeholder="Why is this file rejected?" />
            <Button
              variant="danger"
              disabled={!rejectNote.trim() || rejectMutation.isPending}
              onClick={() => rejectMutation.mutate(rejectNote.trim())}
            >
              {rejectMutation.isPending ? "Rejecting..." : "Reject with note"}
            </Button>
          </CardContent>
        </Card>
      )}

      {upload.status === "REJECTED" && upload.vendorNote && (
        <Card className="border-red-200 bg-red-50/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-red-800">Rejection note sent</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-red-700">{upload.vendorNote}</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `docker exec inventory-web sh -c "cd /app && ./node_modules/.bin/tsc -p tsconfig.json --noEmit"`
Expected: no output.

- [ ] **Step 3: Smoke-test in the browser.** Open `http://localhost:3001/supplier-uploads/cmueb0dqs0035oy219hss1esk`. The New tab shows 100 rows, and the Run ETL card is visible. Click **Run ETL**: a result strip shows `N good · M incomplete` and the Good tab is selected. `SKU_GHEE_500G` appears under Incomplete with its Vendor ID cell outlined in red.

- [ ] **Step 4: Commit**

```bash
git add "frontend/app/(app)/supplier-uploads/[id]/page.tsx"
git commit -m "feat(web): vendor ETL review with tabs, batch stocking and returning rows

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Supplier Incomplete data page, sidebar badge, links, and fix page removal

**Files:**
- Create: `frontend/lib/supplier-etl.ts`
- Create: `frontend/app/supplier/incomplete/page.tsx`
- Modify: `frontend/components/icons.tsx` (the `IconName` union on line 3 and the `paths` record)
- Modify: `frontend/components/supplier-sidebar.tsx`
- Modify: `frontend/app/supplier/dashboard/page.tsx` (`SupplierProfile` interface ~line 24, the "Needs fixing" stat card, the notification link ~line 160)
- Modify: `frontend/app/supplier/notifications/page.tsx` (~line 104)
- Modify: `frontend/app/supplier/uploads/[id]/page.tsx` (the "Missing data" card ~lines 220–235)
- Delete: `frontend/app/supplier/uploads/[id]/fix/page.tsx`

**Interfaces:**
- Consumes: the endpoints from Task 6; `supplierApiFetch`, `SupplierApiError` (`.details`) from `@/lib/supplier-api`.
- Produces: `frontend/lib/supplier-etl.ts` exports `ETL_COLUMNS`, `type EtlKey`, `type EditableRow`, `findEmptyColumns(row: EditableRow): string[]`, `toEditableRow(item): EditableRow`, and `NUMBER_KEYS`.

- [ ] **Step 1: Create `frontend/lib/supplier-etl.ts`**

```ts
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
```

- [ ] **Step 2: Create `frontend/app/supplier/incomplete/page.tsx`**

```tsx
"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { SupplierApiError, supplierApiFetch } from "@/lib/supplier-api";
import { Button, Card, CardContent, CardHeader, CardTitle, Empty, Loading, PageHeader } from "@/components/ui";
import {
  ETL_COLUMNS,
  NUMBER_KEYS,
  findEmptyColumns,
  toEditableRow,
  type EditableRow,
  type EtlKey,
} from "@/lib/supplier-etl";

interface IncompleteItem extends Record<EtlKey, string | number | null> {
  id: string;
  missingFields: string[] | null;
  upload: { id: string; originalName: string; vendorNote: string | null; createdAt: string };
}

type RowErrors = Record<string, string[]>;

export default function SupplierIncompletePage() {
  const queryClient = useQueryClient();
  const { data: items, isLoading } = useQuery({
    queryKey: ["supplier-incomplete-items"],
    queryFn: () => supplierApiFetch<IncompleteItem[]>("/supplier-portal/incomplete-items"),
  });

  const [edits, setEdits] = useState<Record<string, EditableRow>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [rowErrors, setRowErrors] = useState<RowErrors>({});
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);

  const groups = useMemo(() => {
    const byUpload = new Map<string, { upload: IncompleteItem["upload"]; rows: IncompleteItem[] }>();
    for (const item of items ?? []) {
      const g = byUpload.get(item.upload.id) ?? { upload: item.upload, rows: [] };
      g.rows.push(item);
      byUpload.set(item.upload.id, g);
    }
    return [...byUpload.values()];
  }, [items]);

  const rowOf = (item: IncompleteItem) => edits[item.id] ?? toEditableRow(item);

  const resubmit = useMutation({
    mutationFn: (payload: Array<Record<string, string | number>>) =>
      supplierApiFetch<{ resubmitted: number; uploads: number }>("/supplier-portal/incomplete-items/resubmit", {
        method: "POST",
        body: { items: payload },
      }),
    onSuccess: (data, payload) => {
      const sent = new Set(payload.map((p) => String(p.id)));
      setEdits((prev) => Object.fromEntries(Object.entries(prev).filter(([id]) => !sent.has(id))));
      setSelected(new Set());
      setRowErrors({});
      setMessage({ tone: "success", text: `${data.resubmitted} row(s) sent back to the vendor for review.` });
      queryClient.invalidateQueries({ queryKey: ["supplier-incomplete-items"] });
      queryClient.invalidateQueries({ queryKey: ["supplier-profile"] });
      queryClient.invalidateQueries({ queryKey: ["supplier-uploads"] });
    },
    onError: (err) => {
      const details = err instanceof SupplierApiError ? (err.details as { rows?: Array<{ id: string; fields: string[] }> } | undefined) : undefined;
      if (details?.rows) setRowErrors(Object.fromEntries(details.rows.map((r) => [r.id, r.fields])));
      setMessage({ tone: "error", text: err instanceof Error ? err.message : "Resubmission failed" });
    },
  });

  if (isLoading) return <Loading />;

  const all = items ?? [];
  const setCell = (item: IncompleteItem, key: EtlKey, value: string) => {
    setEdits((prev) => ({ ...prev, [item.id]: { ...rowOf(item), [key]: value } }));
    setRowErrors((prev) => {
      if (!prev[item.id]) return prev;
      const { [item.id]: _drop, ...rest } = prev;
      return rest;
    });
  };
  const toggle = (ids: string[], on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => (on ? next.add(id) : next.delete(id)));
      return next;
    });

  const handleResubmit = () => {
    const chosen = all.filter((i) => selected.has(i.id));
    const failures = Object.fromEntries(
      chosen.map((i) => [i.id, findEmptyColumns(rowOf(i))]).filter(([, f]) => f.length > 0),
    ) as RowErrors;
    if (Object.keys(failures).length > 0) {
      setRowErrors(failures);
      setMessage({ tone: "error", text: `${Object.keys(failures).length} selected row(s) still have empty values.` });
      return;
    }
    setMessage(null);
    resubmit.mutate(
      chosen.map((i) => {
        const row = rowOf(i);
        return Object.fromEntries([
          ["id", i.id],
          ...ETL_COLUMNS.map(({ key }) => [
            key,
            NUMBER_KEYS.includes(key)
              ? key === "orderQty"
                ? Math.trunc(Number(row[key]))
                : Number(row[key])
              : row[key].trim(),
          ]),
        ]);
      }),
    );
  };

  const isFlagged = (item: IncompleteItem, row: EditableRow, column: string, key: EtlKey) =>
    findEmptyColumns(row).includes(column) ||
    (rowErrors[item.id] ?? []).includes(column) ||
    (column === "sku" &&
      (item.missingFields ?? []).includes("duplicate_sku") &&
      row[key] === String(item[key] ?? ""));

  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow="Needs your correction"
        title="Incomplete data"
        description="Rows the vendor sent back because of empty values or duplicate SKUs. Edit any cell, select the rows, and resubmit them."
        actions={
          all.length > 0 ? (
            <Button onClick={handleResubmit} disabled={selected.size === 0 || resubmit.isPending}>
              {resubmit.isPending ? "Resubmitting..." : `Resubmit ${selected.size} row(s)`}
            </Button>
          ) : null
        }
      />

      {message && (
        <p
          className={`rounded-lg border p-3 text-sm ${
            message.tone === "error" ? "border-red-200 bg-red-50 text-red-700" : "border-emerald-200 bg-emerald-50 text-emerald-800"
          }`}
        >
          {message.text}
        </p>
      )}

      {all.length === 0 ? (
        <Card>
          <CardContent className="pt-6">
            <Empty label="No incomplete data — you're all caught up." />
          </CardContent>
        </Card>
      ) : (
        groups.map(({ upload, rows }) => {
          const ids = rows.map((r) => r.id);
          const allOn = ids.every((id) => selected.has(id));
          return (
            <Card key={upload.id}>
              <CardHeader className="pb-2">
                <CardTitle>{upload.originalName}</CardTitle>
                {upload.vendorNote && (
                  <p className="mt-1 rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
                    Vendor note: {upload.vendorNote}
                  </p>
                )}
              </CardHeader>
              <CardContent>
                <div className="w-full overflow-x-auto rounded-lg border border-zinc-200">
                  <table className="w-full text-sm">
                    <thead className="border-b border-zinc-200 bg-zinc-50/80">
                      <tr>
                        <th className="px-3 py-3">
                          <input
                            type="checkbox"
                            aria-label={`Select all rows in ${upload.originalName}`}
                            className="h-4 w-4 accent-teal-600"
                            checked={allOn}
                            onChange={() => toggle(ids, !allOn)}
                          />
                        </th>
                        {ETL_COLUMNS.map((c) => (
                          <th key={c.column} className="whitespace-nowrap px-2 py-3 text-left text-[10px] font-bold uppercase tracking-[0.1em] text-zinc-500">
                            {c.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100 bg-white">
                      {rows.map((item) => {
                        const row = rowOf(item);
                        return (
                          <tr key={item.id} className={rowErrors[item.id] ? "bg-red-50/40" : ""}>
                            <td className="px-3 py-2">
                              <input
                                type="checkbox"
                                aria-label={`Select row ${row.sku || item.id}`}
                                className="h-4 w-4 accent-teal-600"
                                checked={selected.has(item.id)}
                                onChange={() => toggle([item.id], !selected.has(item.id))}
                              />
                            </td>
                            {ETL_COLUMNS.map((c) => (
                              <td key={c.column} className="px-1 py-1">
                                <input
                                  type={c.kind === "number" ? "number" : "text"}
                                  min={c.kind === "number" ? 0 : undefined}
                                  step={c.key === "orderQty" ? 1 : c.kind === "number" ? 0.01 : undefined}
                                  aria-label={`${c.label} for ${row.sku || item.id}`}
                                  value={row[c.key]}
                                  onChange={(e) => setCell(item, c.key, e.target.value)}
                                  className={`min-h-9 w-full min-w-[7rem] rounded-md border bg-white px-2 py-1 text-sm text-zinc-900 outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-600/15 ${
                                    isFlagged(item, row, c.column, c.key) ? "border-red-400 bg-red-50" : "border-zinc-300"
                                  }`}
                                />
                              </td>
                            ))}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          );
        })
      )}
    </div>
  );
}
```

- [ ] **Step 3: Add an `alert` icon.** In `components/icons.tsx`, append `| "alert"` to the `IconName` union on line 3, and add this entry to the `paths` record:

```tsx
  alert: <><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /><path d="M12 9v4" /><path d="M12 17h.01" /></>,
```

- [ ] **Step 4: Add the sidebar item with a badge.** In `components/supplier-sidebar.tsx`:
  - Add imports: `import { useQuery } from "@tanstack/react-query";` and change the supplier-api import to `import { supplierApiFetch, supplierLogout } from "@/lib/supplier-api";`.
  - Insert `{ href: "/supplier/incomplete", label: "Incomplete data", icon: "alert" },` after the "My uploads" entry in `SUPPLIER_NAV`.
  - Inside `SupplierSidebar()`, after `const router = useRouter();`, add:

```tsx
  const { data: profile } = useQuery({
    queryKey: ["supplier-profile"],
    queryFn: () => supplierApiFetch<{ report: { returnedItems?: number } }>("/supplier-portal/me"),
  });
  const returnedBadge = profile?.report.returnedItems ?? 0;
```

  - Directly after the existing `{isNotifications && unreadBadge !== null && … : null}` expression, add:

```tsx
                {item.href === "/supplier/incomplete" && returnedBadge > 0 ? (
                  <span className="ml-auto rounded-full bg-amber-500 px-2 py-0.5 text-[10px] font-bold text-white">{returnedBadge}</span>
                ) : null}
```

- [ ] **Step 5: Update the dashboard.** In `app/supplier/dashboard/page.tsx`:
  - In `interface SupplierProfile`, add `returnedItems: number;` inside `report`.
  - Replace `const incomplete = report?.counts?.INCOMPLETE ?? 0;` with `const returnedRows = report?.returnedItems ?? 0;`.
  - Replace the "Needs fixing" stat card with `<StatCard label="Rows to fix" value={returnedRows} hint="on the Incomplete data page" color="amber" />`.
  - Replace the link `href={n.upload.status === "INCOMPLETE" ? \`/supplier/uploads/${n.upload.id}/fix\` : \`/supplier/uploads/${n.upload.id}\`}` with `href={n.upload.status === "INCOMPLETE" ? "/supplier/incomplete" : \`/supplier/uploads/${n.upload.id}\`}`.

- [ ] **Step 6: Update the notifications page.** In `app/supplier/notifications/page.tsx` (~line 104), replace `` `/supplier/uploads/${n.upload.id}/fix` `` with `"/supplier/incomplete"`.

- [ ] **Step 7: Update the supplier upload detail card.** In `app/supplier/uploads/[id]/page.tsx`, in the `{isIncomplete && ( … )}` card, change the paragraph text to `The vendor sent some rows of this upload back because they have empty values or duplicate SKUs. Correct them on the Incomplete data page and resubmit.`, the link's `href` to `"/supplier/incomplete"`, and its label to `Open Incomplete data`.

- [ ] **Step 8: Delete the fix page and check for leftover links**

Run: `rm "/Volumes/work/personal/pos/frontend/app/supplier/uploads/[id]/fix/page.tsx" && rmdir "/Volumes/work/personal/pos/frontend/app/supplier/uploads/[id]/fix" && grep -rn "/fix" /Volumes/work/personal/pos/frontend/app /Volumes/work/personal/pos/frontend/components`
Expected: grep prints nothing.

- [ ] **Step 9: Typecheck**

Run: `docker exec inventory-web sh -c "cd /app && ./node_modules/.bin/tsc -p tsconfig.json --noEmit"`
Expected: no output. (If `.next/types` still references the deleted fix route, run `docker exec inventory-web sh -c "rm -rf /app/.next/types"` and re-run.)

- [ ] **Step 10: Commit**

```bash
git add frontend/lib/supplier-etl.ts frontend/app/supplier/incomplete frontend/components/icons.tsx frontend/components/supplier-sidebar.tsx frontend/app/supplier/dashboard/page.tsx frontend/app/supplier/notifications/page.tsx "frontend/app/supplier/uploads/[id]/page.tsx"
git add -A "frontend/app/supplier/uploads/[id]/fix"
git commit -m "feat(web): supplier Incomplete data page with editable resubmission

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: End-to-end verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full backend suite and both typechecks**

Run: `docker exec inventory-api sh -c "cd /app/apps/api && npx tsc -p tsconfig.json --noEmit && npx jest" && docker exec inventory-web sh -c "cd /app && ./node_modules/.bin/tsc -p tsconfig.json --noEmit"`
Expected: all suites pass; no tsc output from either.

- [ ] **Step 2: Vendor walkthrough** on `http://localhost:3001/supplier-uploads/cmueb0dqs0035oy219hss1esk`:
  1. Click Run ETL, then note the good and incomplete counts.
  2. In the Good tab, uncheck all rows but 5, pick store A, and click Add 5 row(s). The Stocked tab now shows 5 rows with store A.
  3. Still in the Good tab, add the remaining good rows to store B. The Stocked tab shows both stores.
  4. The whole-file reject card has disappeared.
  5. In the Incomplete tab, enter a note and click Send. The rows move to Returned, and the upload badge becomes `INCOMPLETE` (or stays `PENDING` if any rows remain elsewhere).

- [ ] **Step 3: Supplier walkthrough.** Log in to the supplier portal (`http://localhost:3001/supplier/login`) as the upload's supplier:
  1. The sidebar shows "Incomplete data" with the returned-row count.
  2. On the page, the rows are grouped under the file name with the vendor note, and empty cells are outlined in red.
  3. Select one row without filling it in and click Resubmit. An inline error appears and nothing is sent.
  4. Fill in the empty cells (the outline clears as you type) and resubmit. You see a success message, the rows disappear, and the badge count drops.
  5. Open the page in a second tab, resubmit the same row from the first tab, then resubmit it from the stale tab. The response is a 409 "no longer waiting for your correction", and nothing changes.

- [ ] **Step 4: Re-run ETL on the resubmitted rows.** Back on the vendor page, the upload is PENDING, the New tab shows the resubmitted rows, and Run ETL classifies only those. Change one resubmitted row's SKU to match an already-stocked SKU before resubmitting: ETL marks it Incomplete with `duplicate sku`.

- [ ] **Step 5: Database check**

Run: `docker exec inventory-postgres psql -U inventory -d inventory_platform -c "select \"etlStatus\", \"stockedLocationId\" is not null as has_loc, count(*) from \"SupplierUploadItem\" where \"uploadId\"='cmueb0dqs0035oy219hss1esk' group by 1,2;"`
Expected: every `STOCKED` row has `has_loc = t`; no other status has a location.
