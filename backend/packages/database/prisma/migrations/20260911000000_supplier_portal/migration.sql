-- CreateEnum
CREATE TYPE "SupplierUploadStatus" AS ENUM ('PENDING', 'REJECTED', 'ACCEPTED');

-- CreateEnum
CREATE TYPE "SupplierNotificationType" AS ENUM ('UPLOAD_RECEIVED', 'REJECTED', 'ACCEPTED');

-- CreateTable
CREATE TABLE "SupplierUser" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "supplierId" TEXT,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "phone" TEXT,
    "status" "EntityStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierRefreshToken" (
    "id" TEXT NOT NULL,
    "supplierUserId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierRefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierUpload" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "supplierUserId" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL DEFAULT 'text/csv',
    "fileSize" INTEGER NOT NULL DEFAULT 0,
    "fileContent" TEXT NOT NULL,
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "status" "SupplierUploadStatus" NOT NULL DEFAULT 'PENDING',
    "submissionCount" INTEGER NOT NULL DEFAULT 1,
    "issues" JSONB,
    "vendorNote" TEXT,
    "locationId" TEXT,
    "acceptedById" TEXT,
    "acceptedAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierUpload_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierUploadItem" (
    "id" TEXT NOT NULL,
    "uploadId" TEXT NOT NULL,
    "poNumber" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL DEFAULT '',
    "vendorName" TEXT NOT NULL DEFAULT '',
    "sku" TEXT NOT NULL,
    "itemDescription" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT '',
    "orderQty" INTEGER NOT NULL DEFAULT 0,
    "unitPriceBdt" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "totalAmountBdt" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "orderDate" TEXT DEFAULT '',
    "deliveryDate" TEXT DEFAULT '',
    "status" TEXT DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierUploadItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierNotification" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "supplierUserId" TEXT NOT NULL,
    "uploadId" TEXT NOT NULL,
    "type" "SupplierNotificationType" NOT NULL DEFAULT 'UPLOAD_RECEIVED',
    "message" TEXT NOT NULL DEFAULT '',
    "readAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierNotification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SupplierUser_email_key" ON "SupplierUser"("email");

-- CreateIndex
CREATE INDEX "SupplierUser_organizationId_idx" ON "SupplierUser"("organizationId");

-- CreateIndex
CREATE INDEX "SupplierUser_supplierId_idx" ON "SupplierUser"("supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierRefreshToken_tokenHash_key" ON "SupplierRefreshToken"("tokenHash");

-- CreateIndex
CREATE INDEX "SupplierRefreshToken_supplierUserId_idx" ON "SupplierRefreshToken"("supplierUserId");

-- CreateIndex
CREATE INDEX "SupplierUpload_organizationId_idx" ON "SupplierUpload"("organizationId");

-- CreateIndex
CREATE INDEX "SupplierUpload_supplierUserId_idx" ON "SupplierUpload"("supplierUserId");

-- CreateIndex
CREATE INDEX "SupplierUpload_organizationId_status_idx" ON "SupplierUpload"("organizationId", "status");

-- CreateIndex
CREATE INDEX "SupplierUploadItem_uploadId_idx" ON "SupplierUploadItem"("uploadId");

-- CreateIndex
CREATE INDEX "SupplierUploadItem_sku_idx" ON "SupplierUploadItem"("sku");

-- CreateIndex
CREATE INDEX "SupplierNotification_supplierUserId_idx" ON "SupplierNotification"("supplierUserId");

-- CreateIndex
CREATE INDEX "SupplierNotification_supplierUserId_readAt_idx" ON "SupplierNotification"("supplierUserId", "readAt");

-- CreateIndex
CREATE INDEX "SupplierNotification_uploadId_idx" ON "SupplierNotification"("uploadId");

-- AddForeignKey
ALTER TABLE "SupplierUser" ADD CONSTRAINT "SupplierUser_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierUser" ADD CONSTRAINT "SupplierUser_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierRefreshToken" ADD CONSTRAINT "SupplierRefreshToken_supplierUserId_fkey" FOREIGN KEY ("supplierUserId") REFERENCES "SupplierUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierUpload" ADD CONSTRAINT "SupplierUpload_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierUpload" ADD CONSTRAINT "SupplierUpload_supplierUserId_fkey" FOREIGN KEY ("supplierUserId") REFERENCES "SupplierUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierUpload" ADD CONSTRAINT "SupplierUpload_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierUploadItem" ADD CONSTRAINT "SupplierUploadItem_uploadId_fkey" FOREIGN KEY ("uploadId") REFERENCES "SupplierUpload"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierNotification" ADD CONSTRAINT "SupplierNotification_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierNotification" ADD CONSTRAINT "SupplierNotification_supplierUserId_fkey" FOREIGN KEY ("supplierUserId") REFERENCES "SupplierUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierNotification" ADD CONSTRAINT "SupplierNotification_uploadId_fkey" FOREIGN KEY ("uploadId") REFERENCES "SupplierUpload"("id") ON DELETE CASCADE ON UPDATE CASCADE;
