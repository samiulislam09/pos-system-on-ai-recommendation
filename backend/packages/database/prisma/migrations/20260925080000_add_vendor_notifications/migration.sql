-- CreateEnum
CREATE TYPE "VendorNotificationType" AS ENUM ('UPLOAD_SUBMITTED', 'UPLOAD_RESUBMITTED', 'ROWS_RESUBMITTED');

-- CreateTable
CREATE TABLE "VendorNotification" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "uploadId" TEXT NOT NULL,
    "type" "VendorNotificationType" NOT NULL,
    "message" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VendorNotification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VendorNotification_userId_readAt_idx" ON "VendorNotification"("userId", "readAt");

-- CreateIndex
CREATE INDEX "VendorNotification_uploadId_idx" ON "VendorNotification"("uploadId");

-- AddForeignKey
ALTER TABLE "VendorNotification" ADD CONSTRAINT "VendorNotification_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorNotification" ADD CONSTRAINT "VendorNotification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorNotification" ADD CONSTRAINT "VendorNotification_uploadId_fkey" FOREIGN KEY ("uploadId") REFERENCES "SupplierUpload"("id") ON DELETE CASCADE ON UPDATE CASCADE;

