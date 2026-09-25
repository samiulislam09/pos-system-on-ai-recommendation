-- AlterEnum
ALTER TYPE "SupplierUploadStatus" ADD VALUE 'INCOMPLETE';

-- AlterTable
ALTER TABLE "SupplierUploadItem" ADD COLUMN "missingFields" JSONB;
