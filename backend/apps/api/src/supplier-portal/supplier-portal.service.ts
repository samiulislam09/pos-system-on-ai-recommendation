import { Injectable } from "@nestjs/common";
import { Prisma, SupplierItemEtlStatus, SupplierUploadStatus } from "@inv/database";
import { hashPassword } from "@inv/database";
import { PrismaService } from "../prisma/prisma.service";
import { InventoryEngine } from "../inventory/inventory-engine.service";
import { TenantService } from "../common/tenant.service";
import { AuditService } from "../audit/audit.service";
import { AiService } from "../ai/ai.service";
import { invalidOperation, notFound, tenantMismatch } from "../common/errors";
import type {
  AcceptSupplierUploadInput,
  RunSupplierUploadEtlInput,
  CreateSupplierUserInput,
  RejectSupplierUploadInput,
  ReturnIncompleteInput,
} from "@inv/validation";
import type { AuthUser } from "../common/decorators/auth.decorator";
import { isFieldApplied, selectGoodItems, selectItemsByStatus } from "./accept-selection.util";
import { classifyRows } from "./etl.util";
import { lockUpload, syncUploadStatus } from "./upload-status.util";
import { NotificationStream } from "./notification-stream.service";

@Injectable()
export class SupplierPortalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly engine: InventoryEngine,
    private readonly tenant: TenantService,
    private readonly audit: AuditService,
    private readonly ai: AiService,
    private readonly notificationStream: NotificationStream,
  ) {}

  // ---------------------------------------------------------------------------
  // Vendor review queue
  // ---------------------------------------------------------------------------

  async listUploads(
    organizationId: string,
    page: number,
    limit: number,
    status?: SupplierUploadStatus,
    search?: string,
  ) {
    const where: Prisma.SupplierUploadWhereInput = {
      organizationId,
      ...(status ? { status } : {}),
      ...(search
        ? { supplierUser: { name: { contains: search, mode: "insensitive" } } }
        : {}),
    };

    const [data, total] = await Promise.all([
      this.prisma.supplierUpload.findMany({
        where,
        include: {
          supplierUser: { select: { id: true, name: true, email: true } },
          location: { select: { id: true, name: true, type: true } },
          _count: { select: { items: true } },
        },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.supplierUpload.count({ where }),
    ]);

    const counts = await this.uploadCounts(organizationId);
    return {
      data,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit), counts },
    };
  }

  async getUpload(organizationId: string, id: string) {
    const upload = await this.prisma.supplierUpload.findFirst({
      where: { id, organizationId },
      include: {
        supplierUser: { select: { id: true, name: true, email: true, phone: true } },
        location: { select: { id: true, name: true, type: true } },
        items: {
          orderBy: { id: "asc" },
          include: { stockedLocation: { select: { id: true, name: true } } },
        },
        notifications: { orderBy: { createdAt: "desc" } },
      },
    });
    if (!upload) throw notFound("Supplier upload", id);
    return upload;
  }

  /**
   * Classify the selected NEW rows (or all of them) into GOOD / INCOMPLETE,
   * checking only the selected columns. Other rows are untouched.
   */
  async runEtl(
    organizationId: string,
    id: string,
    input: RunSupplierUploadEtlInput,
    actor: AuthUser,
  ) {
    const upload = await this.assertOrgUpload(organizationId, id);
    if (upload.status !== SupplierUploadStatus.PENDING) {
      throw invalidOperation("ETL can only run on uploads waiting for vendor review");
    }

    return this.prisma.$transaction(async (tx) => {
      await lockUpload(
        tx,
        upload.id,
        [SupplierUploadStatus.PENDING],
        "ETL can only run on uploads waiting for vendor review",
      );
      const items = await tx.supplierUploadItem.findMany({
        where: { uploadId: upload.id },
        orderBy: { id: "asc" },
      });
      const { selected: fresh, invalidIds } = selectItemsByStatus(
        items,
        SupplierItemEtlStatus.NEW,
        input.itemIds,
      );
      if (invalidIds.length > 0) {
        throw invalidOperation(
          `${invalidIds.length} selected row(s) are no longer new. Refresh the page and try again.`,
        );
      }
      if (fresh.length === 0) throw invalidOperation("There are no new rows to process");

      const existingSkus = items
        .filter(
          (i) =>
            i.etlStatus === SupplierItemEtlStatus.GOOD ||
            i.etlStatus === SupplierItemEtlStatus.STOCKED,
        )
        .map((i) => i.sku);
      const results = classifyRows(fresh, existingSkus, input.columns);

      for (const r of results) {
        await tx.supplierUploadItem.updateMany({
          where: { id: r.id, etlStatus: SupplierItemEtlStatus.NEW },
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
        newValue: { good, incomplete, columns: input.columns ?? "all" },
      });
      return { good, incomplete, status };
    });
  }

  /**
   * Stock GOOD rows into a location. Can be repeated per location; products
   * are upserted and stock is added via the inventory ledger, all inside a
   * single transaction.
   */
  async acceptUpload(
    organizationId: string,
    id: string,
    input: AcceptSupplierUploadInput,
    actor: AuthUser,
  ) {
    const upload = await this.assertOrgUpload(organizationId, id);
    if (upload.status !== SupplierUploadStatus.PENDING) {
      throw invalidOperation("Only uploads waiting for vendor review can be stocked");
    }
    const location = await this.tenant.assertLocation(organizationId, input.locationId);

    // Assigned inside the transaction; published only after it commits.
    let notification = undefined as { message: string } | undefined;
    const result = await this.prisma.$transaction(async (tx) => {
      await lockUpload(
        tx,
        upload.id,
        [SupplierUploadStatus.PENDING],
        "Only uploads waiting for vendor review can be stocked",
      );
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
        const claim = await tx.supplierUploadItem.updateMany({
          where: { id: item.id, etlStatus: SupplierItemEtlStatus.GOOD },
          data: {
            etlStatus: SupplierItemEtlStatus.STOCKED,
            stockedLocationId: location.id,
            stockedAt: now,
          },
        });
        if (claim.count !== 1) {
          throw invalidOperation(
            "Some selected rows were already stocked by someone else. Refresh the page and try again.",
          );
        }

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
              ...(isFieldApplied(input.fields, "unitPriceBdt") && Number(item.unitPriceBdt) > 0
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

      notification = await tx.supplierNotification.create({
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

    this.notificationStream.publish({
      audience: "supplier",
      recipientId: upload.supplierUserId,
      message: notification?.message,
    });

    // Asynchronously trigger ML demand forecast & shortage retraining
    this.ai.runPipeline().catch((err) => {
      // Non-blocking: log pipeline trigger status if ML service is offline
      console.warn("Auto-trigger ML pipeline after supplier upload acceptance:", err?.message || err);
    });

    return result;
  }

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

    // Assigned inside the transaction; published only after it commits.
    let notification = undefined as { message: string } | undefined;
    const result = await this.prisma.$transaction(async (tx) => {
      await lockUpload(
        tx,
        upload.id,
        [SupplierUploadStatus.PENDING],
        "Only uploads waiting for vendor review can return rows",
      );
      const { count } = await tx.supplierUploadItem.updateMany({
        where: { uploadId: upload.id, etlStatus: SupplierItemEtlStatus.INCOMPLETE },
        data: { etlStatus: SupplierItemEtlStatus.RETURNED },
      });
      if (count === 0) throw invalidOperation("There are no incomplete rows to send back");

      // Keep an earlier note for rows still RETURNED from a previous batch.
      if (note) {
        await tx.supplierUpload.update({ where: { id: upload.id }, data: { vendorNote: note } });
      }
      const status = await syncUploadStatus(tx, upload.id);

      notification = await tx.supplierNotification.create({
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
    this.notificationStream.publish({
      audience: "supplier",
      recipientId: upload.supplierUserId,
      message: notification?.message,
    });
    return result;
  }

  async rejectUpload(
    organizationId: string,
    id: string,
    input: RejectSupplierUploadInput,
    actor: AuthUser,
  ) {
    const upload = await this.assertOrgUpload(organizationId, id);
    const wrongStatus = "Only uploads waiting for vendor review can be rejected";
    if (upload.status !== SupplierUploadStatus.PENDING) throw invalidOperation(wrongStatus);

    const result = await this.prisma.$transaction(async (tx) => {
      await lockUpload(tx, upload.id, [SupplierUploadStatus.PENDING], wrongStatus);
      const stocked = await tx.supplierUploadItem.count({
        where: { uploadId: upload.id, etlStatus: SupplierItemEtlStatus.STOCKED },
      });
      if (stocked > 0) {
        throw invalidOperation(
          "Rows from this upload are already in stock. Send the incomplete rows back instead of rejecting the file.",
        );
      }
      const updated = await tx.supplierUpload.update({
        where: { id: upload.id },
        data: {
          status: SupplierUploadStatus.REJECTED,
          vendorNote: input.note,
          rejectedAt: new Date(),
        },
      });
      await tx.supplierNotification.create({
        data: {
          organizationId,
          uploadId: upload.id,
          supplierUserId: upload.supplierUserId,
          type: "REJECTED",
          message: input.note,
        },
      });
      await this.audit.log(tx, {
        organizationId,
        userId: actor.id,
        action: "SUPPLIER_UPLOAD_REJECTED",
        entity: "SupplierUpload",
        entityId: upload.id,
        oldValue: { status: upload.status },
        newValue: { status: "REJECTED", note: input.note },
      });
      return updated;
    });
    this.notificationStream.publish({
      audience: "supplier",
      recipientId: upload.supplierUserId,
      message: `"${upload.originalName}" was rejected: ${input.note}`,
    });
    return result;
  }

  // ---------------------------------------------------------------------------
  // Supplier account management (vendor side)
  // ---------------------------------------------------------------------------

  async listSupplierUsers(organizationId: string) {
    const users = await this.prisma.supplierUser.findMany({
      where: { organizationId },
      include: {
        supplier: { select: { id: true, name: true, phone: true } },
        _count: { select: { uploads: true, notifications: true } },
      },
      orderBy: { name: "asc" },
    });
    const counts = await this.prisma.supplierUpload.groupBy({
      by: ["status"],
      where: { organizationId },
      _count: { _all: true },
    });
    return {
      data: users,
      meta: {
        counts: Object.fromEntries(
          counts.map((c) => [c.status, c._count._all]),
        ),
      },
    };
  }

  async createSupplierUser(organizationId: string, input: CreateSupplierUserInput, actor: AuthUser) {
    if (input.supplierId) {
      await this.tenant.assertSupplier(organizationId, input.supplierId);
    }
    const email = input.email.toLowerCase();

    const [existingPortal, existingUser] = await Promise.all([
      this.prisma.supplierUser.findUnique({ where: { email } }),
      this.prisma.user.findUnique({ where: { email } }),
    ]);
    if (existingPortal || existingUser) {
      const message = existingPortal
        ? "A supplier account with this email already exists"
        : "This email is already used by an organization account";
      throw invalidOperation(message);
    }

    const user = await this.prisma.supplierUser.create({
      data: {
        organizationId,
        supplierId: input.supplierId ?? null,
        name: input.name,
        email,
        passwordHash: await hashPassword(input.password),
        phone: input.phone ?? null,
      },
    });
    await this.audit.log(this.prisma, {
      organizationId,
      userId: actor.id,
      action: "SUPPLIER_USER_CREATED",
      entity: "SupplierUser",
      entityId: user.id,
      newValue: { name: user.name, email: user.email },
    });
    const { passwordHash, ...safe } = user;
    void passwordHash;
    return safe;
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private async assertOrgUpload(organizationId: string, id: string) {
    const upload = await this.prisma.supplierUpload.findFirst({
      where: { id },
      include: { supplierUser: { select: { id: true, email: true } } },
    });
    if (!upload || upload.organizationId !== organizationId) {
      throw tenantMismatch("Supplier upload");
    }
    return upload;
  }

  private async findOrCreateCategory(
    tx: Prisma.TransactionClient,
    organizationId: string,
    name: string,
  ) {
    const trimmed = name.trim();
    if (!trimmed) return null;
    const existing = await tx.category.findFirst({
      where: { organizationId, name: trimmed },
    });
    if (existing) return existing;
    return tx.category.create({ data: { organizationId, name: trimmed } });
  }

  private async uploadCounts(organizationId: string) {
    const rows = await this.prisma.supplierUpload.groupBy({
      by: ["status"],
      where: { organizationId },
      _count: { _all: true },
    });
    return Object.fromEntries(rows.map((r) => [r.status, r._count._all]));
  }
}