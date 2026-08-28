import { Injectable } from "@nestjs/common";
import { SaleReturnStatus } from "@inv/database";
import { PrismaService } from "../prisma/prisma.service";
import { InventoryEngine } from "../inventory/inventory-engine.service";
import { AuditService } from "../audit/audit.service";
import { invalidOperation, notFound } from "../common/errors";
import { ApproveReturnInput } from "@inv/validation";
import type { AuthUser } from "../common/decorators/auth.decorator";

@Injectable()
export class ReturnsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly engine: InventoryEngine,
    private readonly audit: AuditService,
  ) {}

  async list(organizationId: string, page: number, limit: number, storeId?: string) {
    const where = { organizationId, ...(storeId ? { storeId } : {}) };
    const [data, total] = await Promise.all([
      this.prisma.saleReturn.findMany({
        where,
        include: { items: { include: { product: true } }, sale: true, store: true },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.saleReturn.count({ where }),
    ]);
    return { data, meta: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  }

  async get(organizationId: string, id: string) {
    const saleReturn = await this.prisma.saleReturn.findFirst({
      where: { id, organizationId },
      include: {
        items: { include: { product: true, saleItem: true } },
        sale: { include: { items: true } },
        store: true,
      },
    });
    if (!saleReturn) throw notFound("Return", id);
    return saleReturn;
  }

  /**
   * Approval is the ONLY way stock is added back for a return. This prevents
   * arbitrary inventory inflation through the return API (spec §14).
   */
  async approve(organizationId: string, id: string, input: ApproveReturnInput, actor: AuthUser) {
    return this.prisma.$transaction(async (tx) => {
      const saleReturn = await tx.saleReturn.findFirst({
        where: { id, organizationId },
        include: { items: true },
      });
      if (!saleReturn) throw notFound("Return", id);
      if (saleReturn.status !== SaleReturnStatus.REQUESTED) {
        throw invalidOperation(`Return is already ${saleReturn.status.toLowerCase()}`);
      }

      const byId = new Map(input.items.map((i) => [i.returnItemId, i.quantity]));
      const applied: { productId: string; quantity: number }[] = [];

      for (const item of saleReturn.items) {
        const qty = byId.get(item.id);
        if (qty === undefined) continue;
        if (qty > item.quantity) {
          throw invalidOperation(
            `Cannot return more than ${item.quantity} for item ${item.id}`,
          );
        }
        await this.engine.applyMovement({
          db: tx,
          organizationId,
          productId: item.productId,
          locationId: saleReturn.storeId,
          type: "RETURN",
          quantity: qty,
          referenceType: "SaleReturn",
          referenceId: saleReturn.id,
          createdById: actor.id,
        });
        applied.push({ productId: item.productId, quantity: qty });
      }

      if (applied.length === 0) {
        throw invalidOperation("No return items approved");
      }

      const updated = await tx.saleReturn.update({
        where: { id },
        data: { status: SaleReturnStatus.APPROVED, approvedById: actor.id, approvedAt: new Date() },
        include: { items: true },
      });

      await this.audit.log(tx, {
        organizationId,
        userId: actor.id,
        action: "RETURN_APPROVED",
        entity: "SaleReturn",
        entityId: saleReturn.id,
        oldValue: { status: saleReturn.status },
        newValue: { status: updated.status, items: applied },
      });

      return updated;
    });
  }

  async reject(organizationId: string, id: string, actor: AuthUser) {
    const saleReturn = await this.prisma.saleReturn.findFirst({
      where: { id, organizationId },
    });
    if (!saleReturn) throw notFound("Return", id);
    if (saleReturn.status !== SaleReturnStatus.REQUESTED) {
      throw invalidOperation(`Return is already ${saleReturn.status.toLowerCase()}`);
    }
    const updated = await this.prisma.saleReturn.update({
      where: { id },
      data: { status: SaleReturnStatus.REJECTED, approvedById: actor.id, approvedAt: new Date() },
    });
    await this.audit.log(this.prisma, {
      organizationId,
      userId: actor.id,
      action: "RETURN_REJECTED",
      entity: "SaleReturn",
      entityId: saleReturn.id,
      oldValue: { status: saleReturn.status },
      newValue: { status: updated.status },
    });
    return updated;
  }
}