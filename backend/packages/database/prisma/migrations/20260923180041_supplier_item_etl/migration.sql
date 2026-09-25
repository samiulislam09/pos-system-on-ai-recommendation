-- CreateEnum
CREATE TYPE "SupplierItemEtlStatus" AS ENUM ('NEW', 'GOOD', 'INCOMPLETE', 'RETURNED', 'STOCKED');

-- AlterTable
ALTER TABLE "SupplierUploadItem" ADD COLUMN     "etlStatus" "SupplierItemEtlStatus" NOT NULL DEFAULT 'NEW',
ADD COLUMN     "stockedAt" TIMESTAMP(3),
ADD COLUMN     "stockedLocationId" TEXT;

-- CreateIndex
CREATE INDEX "SupplierUploadItem_uploadId_etlStatus_idx" ON "SupplierUploadItem"("uploadId", "etlStatus");

-- AddForeignKey
ALTER TABLE "SupplierUploadItem" ADD CONSTRAINT "SupplierUploadItem_stockedLocationId_fkey" FOREIGN KEY ("stockedLocationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

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
