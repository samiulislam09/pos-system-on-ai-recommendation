# Supplier Upload ETL — Design

**Date:** 2026-09-23
**Status:** Approved in conversation, pending written-spec review

## Goal

On the vendor's supplier-upload review page (`/supplier-uploads/[id]`), the vendor runs an
ETL step that sorts the upload's rows into **good** (every column filled in) and
**incomplete** (any null/empty value, or a duplicate SKU). Good rows can be added to
stock in any store, over several batches. Incomplete rows are sent back to the
supplier, who fixes them on a new **Incomplete data** page (an editable table
covering all of their uploads) and resubmits them into the original upload.

## Decisions (from the user)

| Topic | Decision |
|---|---|
| What counts as incomplete | Any of the 12 CSV columns is empty |
| Upload-time blocking | Removed; every upload becomes a DRAFT, the supplier submits it, and the vendor runs ETL |
| Stocking good rows | Multiple batches, each to any store |
| Resubmitted rows | Go back into the original upload |
| Sending back incomplete rows | Separate manual button with an optional note (ETL does not send them) |
| Modeling | A status on each row (approach A) |
| Duplicate SKUs | ETL marks the 2nd and later occurrences INCOMPLETE with the reason `duplicate_sku` |
| Old `/supplier/uploads/[id]/fix` flow | Retired; replaced by the Incomplete data page |
| Supplier editing | Any cell can be edited, not just the empty ones |

## 1. Data model

New enum and fields in `backend/packages/database/prisma/schema.prisma`:

```prisma
enum SupplierItemEtlStatus {
  NEW         // not yet classified (fresh upload or resubmitted by the supplier)
  GOOD        // passed ETL, waiting to be stocked
  INCOMPLETE  // failed ETL, still with the vendor
  RETURNED    // sent back to the supplier
  STOCKED     // added to a location's stock
}

model SupplierUploadItem {
  // ...existing fields...
  etlStatus         SupplierItemEtlStatus @default(NEW)
  stockedLocationId String?
  stockedLocation   Location? @relation(fields: [stockedLocationId], references: [id], onDelete: Restrict)
  stockedAt         DateTime?
  @@index([uploadId, etlStatus])
}
```

`missingFields` (the existing JSON column) holds the list of failing column names written
by ETL, e.g. `["vendor_id", "delivery_date"]` or `["duplicate_sku"]`.

**Migration backfill (SQL inside the migration):**
- Items of ACCEPTED uploads become `STOCKED`, with `stockedLocationId` and `stockedAt` copied from the upload.
- Items of INCOMPLETE uploads whose `missingFields` is non-empty become `RETURNED`; their other items stay `NEW`.
- All other items stay `NEW`.

### Row lifecycle

```
NEW ──ETL──► GOOD ──add to store X──► STOCKED
   └──ETL──► INCOMPLETE ──send back──► RETURNED ──supplier fixes & resubmits──► NEW
```

### Upload status is derived from its rows

Pure function `deriveUploadStatus(itemStatuses)`, run after every row change on an upload
that is not DRAFT or REJECTED:

1. If any row is NEW, GOOD, or INCOMPLETE, the upload is `PENDING` (the vendor has work; it shows in the queue).
2. Otherwise, if any row is RETURNED, it is `INCOMPLETE` (waiting on the supplier).
3. Otherwise (every row STOCKED), it is `ACCEPTED`.

`DRAFT` (not yet submitted by the supplier) and `REJECTED` (whole file rejected) are set
explicitly, never derived. An upload with zero rows cannot exist (the upload is rejected at
parse time).

### Upload time

`createUpload` always creates the upload as `DRAFT`. Parse issues and missing
values are still stored in `issues`/`missingFields` so the supplier sees the flags while
reviewing the draft. `initialUploadStatus` is removed. Rejection resubmits
(`resubmit`, `resubmitWithEdits`) replace the rows with NEW rows and set `PENDING`
directly; they no longer route to INCOMPLETE.

## 2. Shared completeness check

`backend/apps/api/src/supplier-portal/etl.util.ts` contains pure functions:

- `ETL_COLUMNS`: the 12 CSV column names, each mapped to its item property
  (`po_number→poNumber`, …, `status→status`).
- `findEmptyColumns(row)` returns the names of columns whose value is empty. Text fields
  are empty when blank after trimming. Numeric fields are checked against a
  "value present" signal: because the CSV parser defaults a missing number to `0`, ETL
  treats `order_qty <= 0`, `unit_price_bdt <= 0`, and `total_amount_bdt <= 0` as empty.
  (A shipment line with a zero quantity or price is not stockable data.)
- `classifyRows(rows)` returns, for each row, `{ status: GOOD | INCOMPLETE, missing: string[] }`,
  applying `findEmptyColumns` plus duplicate-SKU detection (case-insensitive, trimmed).
  Duplicate detection counts SKUs from the rows passed in **and** from the upload's rows that
  are already GOOD or STOCKED, so a resubmitted row cannot duplicate one that was already accepted.

The same `findEmptyColumns` validates supplier resubmits (section 4) and runs in the browser
(a mirrored copy of the column list and rule lives in the frontend page).

## 3. Vendor page `/supplier-uploads/[id]`

### Endpoints (`supplier-portal.controller.ts`, `/supplier-portal/manage/uploads/:id/...`)

| Method & path | Body | Effect |
|---|---|---|
| `POST .../etl` | none | Classifies NEW rows into GOOD/INCOMPLETE and writes `missingFields`, then re-derives the upload status. Returns `{ good, incomplete }` counts for this run. Fails if the upload is DRAFT or REJECTED. |
| `POST .../accept` (changed) | `{ locationId, itemIds?, fields? }` | Stocks **GOOD** rows only (all GOOD rows if `itemIds` is omitted; the call fails if any listed id is not GOOD). Rows become STOCKED with `stockedLocationId`/`stockedAt`. Product upsert, column selection, and inventory movement work as today. Sets `upload.locationId` to this location and `acceptedAt`/`acceptedById` on first stocking. Re-derives the status and triggers the AI pipeline. |
| `POST .../return-incomplete` | `{ note?: string (≤2000) }` | Every INCOMPLETE row becomes RETURNED. Creates one supplier notification of type `REJECTED` containing the row count and the note, stores the note in `upload.vendorNote`, and re-derives the status. Fails if there are no INCOMPLETE rows. |
| `POST .../reject` (changed) | `{ note }` | Whole-file reject, allowed only while no row is STOCKED. |

All mutations run in one transaction, and each is audit-logged (`SUPPLIER_UPLOAD_ETL_RUN`,
`SUPPLIER_UPLOAD_STOCKED`, `SUPPLIER_UPLOAD_ROWS_RETURNED`).

`GET /manage/uploads/:id` also returns `etlStatus`, `stockedAt`, and
`stockedLocation { id, name }` for each item.

### UI

- Header: status badge plus row counts per ETL status.
- A **Run ETL** button (primary) shows when any row is NEW. After a run, a result strip reads
  "82 good · 18 incomplete".
- **Filter tabs** above the items table: New · Good · Incomplete · Returned · Stocked (each with a count).
  Every row shows an ETL badge, and cells named in `missingFields` get a red outline.
- **Good tab:** the existing row/column selection, a store picker, and an "Add N rows to stock" button.
  Can be repeated with different stores.
- **Incomplete tab:** an optional note field and a "Send N incomplete rows to supplier" button.
- **Stocked tab:** extra columns for Store and Stocked-at.
- The whole-file reject panel shows only while no row is STOCKED and the upload is PENDING.
- The old single "Accept shipment" panel is replaced by the Good-tab controls.

## 4. Supplier Incomplete data page `/supplier/incomplete`

### Endpoints (`supplier-uploads.controller.ts`)

| Method & path | Body | Effect |
|---|---|---|
| `GET /supplier-portal/incomplete-items` | none | All RETURNED rows for this supplier user, with `upload { id, originalName, vendorNote }`, ordered by upload creation time and then row id. |
| `POST /supplier-portal/incomplete-items/resubmit` | `{ items: [{ id, poNumber, vendorId, vendorName, sku, itemDescription, category, orderQty, unitPriceBdt, totalAmountBdt, orderDate, deliveryDate, status }] }` (min 1) | Every id must be a RETURNED row owned by this supplier. Runs `findEmptyColumns` on each edited row; if any row fails, nothing is saved and a 400 lists `{ id, fields[] }` per failing row. Otherwise the edits are saved, rows become NEW with `missingFields = []`, each affected upload's status is re-derived (so it returns to PENDING), `submissionCount` is incremented once per affected upload, and one `UPLOAD_RECEIVED` notification is sent per affected upload. |

`GET /supplier-portal/me` report counts gain `returnedItems` (number of RETURNED rows), which
drives the sidebar badge.

### UI

- A sidebar item "Incomplete data" (after "My uploads") with a count badge when greater than 0.
- Rows are grouped by upload. Each group header shows the file name and the vendor's note.
- A fully editable table: all 12 columns are inputs (number inputs for qty and prices).
  Cells listed in `missingFields`, and cells that are currently empty, get a red outline
  that updates live as the supplier types.
- Row checkboxes, a select-all per group and overall, and a "Resubmit N rows" button.
  The client runs the same empty-column check first and blocks submission with inline messages.
  Per-row errors from the server are shown the same way.
- Empty state: "No incomplete data — you're all caught up."
- Dashboard notification links and the supplier upload detail page's "Missing data" card point to
  `/supplier/incomplete` instead of `/supplier/uploads/[id]/fix`.

### Retired

- `frontend/app/supplier/uploads/[id]/fix/page.tsx` is deleted.
- `POST /supplier-portal/uploads/:id/fix`, `fixItems`, and `fixSupplierUploadSchema` are deleted.

## 5. Error handling

- ETL, stock, and return calls on the wrong upload status or with no matching rows return `invalidOperation` with a clear message.
- Accepting ids that are not GOOD is rejected as a whole; there is no partial stocking.
- Resubmit is all-or-nothing, with per-row field errors in the 400 body. The frontend `supplierApiFetch`
  error surface is checked during implementation to make sure structured details reach the page.

## 6. Testing

TDD with Jest, run inside the `inventory-api` container:

- `etl.util.spec.ts`: `findEmptyColumns` (blank text, whitespace, zero/missing numbers, a fully filled row);
  `classifyRows` (good vs. incomplete, duplicate SKUs within the batch and against existing GOOD/STOCKED rows, case-insensitive).
- `upload-status.util.spec.ts`: replace the `initialUploadStatus` tests with `deriveUploadStatus` cases.
- Validation schema tests for the resubmit and return-incomplete bodies.
- Verification: API and web typechecks, the full Jest suite, and a manual walkthrough on upload
  `cmueb0dqs0035oy219hss1esk`: run ETL, stock some good rows to two stores, send incomplete rows back,
  fix and resubmit them as the supplier, run ETL again, and stock them.

## Out of scope

- Undoing stocking or ETL.
- Vendor-side notifications (the queue itself is the signal).
- Editing rows on the vendor side.
