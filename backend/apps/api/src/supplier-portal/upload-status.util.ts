import { Prisma, SupplierItemEtlStatus, SupplierUploadStatus } from "@inv/database";
import { invalidOperation } from "../common/errors";

/**
 * Upload status derived from its rows. REJECTED is set explicitly and never
 * comes from here.
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

/**
 * Re-derive and store an upload's status from its rows. REJECTED uploads are
 * returned unchanged without a write.
 */
export async function syncUploadStatus(
  tx: Prisma.TransactionClient,
  uploadId: string,
): Promise<SupplierUploadStatus> {
  const current = await tx.supplierUpload.findUnique({
    where: { id: uploadId },
    select: { status: true },
  });
  if (current?.status === SupplierUploadStatus.REJECTED) return current.status;
  const items = await tx.supplierUploadItem.findMany({
    where: { uploadId },
    select: { etlStatus: true },
  });
  const status = deriveUploadStatus(items.map((i) => i.etlStatus));
  await tx.supplierUpload.update({ where: { id: uploadId }, data: { status } });
  return status;
}

/** Row-lock the upload for the rest of the transaction and assert its status. */
export async function lockUpload(
  tx: Prisma.TransactionClient,
  uploadId: string,
  allowed: SupplierUploadStatus[],
  message: string,
): Promise<SupplierUploadStatus> {
  await tx.$queryRaw`SELECT id FROM "SupplierUpload" WHERE id = ${uploadId} FOR UPDATE`;
  const upload = await tx.supplierUpload.findUnique({
    where: { id: uploadId },
    select: { status: true },
  });
  if (!upload || !allowed.includes(upload.status)) throw invalidOperation(message);
  return upload.status;
}
