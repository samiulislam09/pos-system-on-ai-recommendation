import { Prisma, SupplierItemEtlStatus as S, SupplierUploadStatus } from "@inv/database";
import { deriveUploadStatus, syncUploadStatus } from "./upload-status.util";

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

describe("syncUploadStatus", () => {
  function fakeTx(status: SupplierUploadStatus, items: S[]) {
    const updates: unknown[] = [];
    const tx = {
      supplierUpload: {
        findUnique: async () => ({ status }),
        update: async (args: unknown) => {
          updates.push(args);
          return {};
        },
      },
      supplierUploadItem: {
        findMany: async () => items.map((etlStatus) => ({ etlStatus })),
      },
    };
    return { tx: tx as unknown as Prisma.TransactionClient, updates };
  }

  it("writes the derived status on a live upload", async () => {
    const { tx, updates } = fakeTx(SupplierUploadStatus.PENDING, [S.RETURNED, S.STOCKED]);
    await expect(syncUploadStatus(tx, "u1")).resolves.toBe(SupplierUploadStatus.INCOMPLETE);
    expect(updates).toEqual([
      { where: { id: "u1" }, data: { status: SupplierUploadStatus.INCOMPLETE } },
    ]);
  });

  it("leaves a REJECTED upload untouched", async () => {
    const { tx, updates } = fakeTx(SupplierUploadStatus.REJECTED, [S.NEW, S.RETURNED]);
    await expect(syncUploadStatus(tx, "u1")).resolves.toBe(SupplierUploadStatus.REJECTED);
    expect(updates).toEqual([]);
  });
});
