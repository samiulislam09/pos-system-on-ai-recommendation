import { Injectable } from "@nestjs/common";
import { Prisma, SupplierUploadStatus } from "@inv/database";
import { hashPassword } from "@inv/database";
import { PrismaService } from "../prisma/prisma.service";
import { InventoryEngine } from "../inventory/inventory-engine.service";
import { TenantService } from "../common/tenant.service";
import { AuditService } from "../audit/audit.service";
import { AiService } from "../ai/ai.service";
import { invalidOperation, notFound, tenantMismatch } from "../common/errors";
import type {
  AcceptSupplierUploadInput,
  CreateSupplierUserInput,
  RejectSupplierUploadInput,
} from "@inv/validation";
import type { AuthUser } from "../common/decorators/auth.decorator";

@Injectable()
export class SupplierPortalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly engine: InventoryEngine,
    private readonly tenant: TenantService,
    private readonly audit: AuditService,
    private readonly ai: AiService,
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
        items: { orderBy: { id: "asc" } },
        notifications: { orderBy: { createdAt: "desc" } },
      },
    });
    if (!upload) throw notFound("Supplier upload", id);
    return upload;
  }

  /**
   * Vendor accepts a pending shipment: products are UPSERTed into the catalog
   * and stock is added to the selected store/warehouse via the inventory
   * ledger, all inside a single transaction.
   */
  async acceptUpload(
    organizationId: string,
    id: string,
    input: AcceptSupplierUploadInput,
    actor: AuthUser,
  ) {
    const upload = await this.assertOrgUpload(organizationId, id);
    if (upload.status !== SupplierUploadStatus.PENDING) {
      throw invalidOperation("Only pending uploads can be accepted");
    }
    const location = await this.tenant.assertLocation(organizationId, input.locationId);

    const result = await this.prisma.$transaction(async (tx) => {
      const items = await tx.supplierUploadItem.findMany({
        where: { uploadId: upload.id },
      });

      const validItems = items.filter(
        (i) => i.sku.trim().length > 0 && i.orderQty > 0,
      );

      let createdProducts = 0;
      let existingProducts = 0;

      for (const item of validItems) {
        const category = await this.findOrCreateCategory(tx, organizationId, item.category);
        let product = await tx.product.findFirst({
          where: { organizationId, sku: item.sku },
        });
        if (product) {
          existingProducts++;
          product = await tx.product.update({
            where: { id: product.id },
            data: {
              name: item.itemDescription || product.name,
              categoryId: category?.id ?? product.categoryId,
              costPrice: item.unitPriceBdt,
            },
          });
        } else {
          createdProducts++;
          product = await tx.product.create({
            data: {
              organizationId,
              sku: item.sku,
              name: item.itemDescription,
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

      const updated = await tx.supplierUpload.update({
        where: { id: upload.id },
        data: {
          status: SupplierUploadStatus.ACCEPTED,
          locationId: location.id,
          acceptedById: actor.id,
          acceptedAt: new Date(),
        },
      });

      await this.resolveOpenNotifications(tx, upload.id);
      await tx.supplierNotification.create({
        data: {
          organizationId,
          uploadId: upload.id,
          supplierUserId: upload.supplierUserId,
          type: "ACCEPTED",
          message: `Your file "${upload.originalName}" was accepted and ${validItems.length} product(s) were added to ${location.name}.`,
        },
      });

      await this.audit.log(tx, {
        organizationId,
        userId: actor.id,
        action: "SUPPLIER_UPLOAD_ACCEPTED",
        entity: "SupplierUpload",
        entityId: upload.id,
        oldValue: { status: upload.status },
        newValue: { status: "ACCEPTED", location: location.name },
      });

      return {
        ...updated,
        location: { id: location.id, name: location.name },
        createdProducts,
        existingProducts,
        skippedCount: items.length - validItems.length,
      };
    });

    // Asynchronously trigger ML demand forecast & shortage retraining
    this.ai.runPipeline().catch((err) => {
      // Non-blocking: log pipeline trigger status if ML service is offline
      console.warn("Auto-trigger ML pipeline after supplier upload acceptance:", err?.message || err);
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
    if (upload.status === SupplierUploadStatus.ACCEPTED) {
      throw invalidOperation("An accepted upload cannot be rejected");
    }

    return this.prisma.$transaction(async (tx) => {
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

  private async resolveOpenNotifications(
    tx: Prisma.TransactionClient,
    uploadId: string,
  ) {
    await tx.supplierNotification.updateMany({
      where: { uploadId, readAt: null },
      data: { readAt: new Date(), resolvedAt: new Date() },
    });
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