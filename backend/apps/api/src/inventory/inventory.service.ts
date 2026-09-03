import { Injectable } from "@nestjs/common";
import { Prisma, AdjustmentReason, MovementType } from "@inv/database";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { notFound } from "../common/errors";
import { InventoryEngine } from "./inventory-engine.service";
import { AdjustInventoryInput } from "@inv/validation";
import type { AuthUser } from "../common/decorators/auth.decorator";

export interface InventoryFilters {
  locationId?: string;
  categoryId?: string;
  brandId?: string;
  productId?: string;
  stockStatus?: "IN_STOCK" | "LOW_STOCK" | "OUT_OF_STOCK";
}

@Injectable()
export class InventoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly engine: InventoryEngine,
    private readonly audit: AuditService,
  ) {}

  async list(organizationId: string, page: number, limit: number, filters: InventoryFilters) {
    const productIds = filters.categoryId
      ? (
          await this.prisma.product.findMany({
            where: { organizationId, categoryId: filters.categoryId },
            select: { id: true },
          })
        ).map((p) => p.id)
      : undefined;

    // Stock status compares Inventory.quantity to Product.reorderLevel — a
    // cross-table predicate Prisma's where can't express, so resolve the
    // matching row ids in SQL and filter/count/paginate on those.
    let stockStatusIds: string[] | undefined;
    if (filters.stockStatus) {
      const matches = await this.prisma.$queryRaw<{ id: string }[]>`
        SELECT inv.id FROM "Inventory" inv
        JOIN "Product" p ON p.id = inv."productId"
        WHERE inv."organizationId" = ${organizationId}
          AND CASE ${filters.stockStatus}
            WHEN 'OUT_OF_STOCK' THEN inv.quantity <= 0
            WHEN 'LOW_STOCK' THEN inv.quantity > 0 AND inv.quantity <= p."reorderLevel"
            ELSE inv.quantity > p."reorderLevel"
          END
      `;
      stockStatusIds = matches.map((m) => m.id);
    }

    const where: Prisma.InventoryWhereInput = {
      organizationId,
      ...(filters.locationId ? { locationId: filters.locationId } : {}),
      ...(filters.productId ? { productId: filters.productId } : {}),
      ...(productIds ? { productId: { in: productIds } } : {}),
      ...(filters.brandId
        ? { product: { brandId: filters.brandId, organizationId } }
        : {}),
      ...(stockStatusIds ? { id: { in: stockStatusIds } } : {}),
    };

    const [data, total] = await Promise.all([
      this.prisma.inventory.findMany({
        where,
        include: {
          product: { include: { brand: true, category: true } },
          location: true,
        },
        orderBy: { updatedAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.inventory.count({ where }),
    ]);

    return { data, meta: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  }

  async getForProduct(organizationId: string, productId: string) {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, organizationId },
      select: { id: true },
    });
    if (!product) throw notFound("Product", productId);
    return this.prisma.inventory.findMany({
      where: { organizationId, productId },
      include: { location: true },
      orderBy: { updatedAt: "desc" },
    });
  }

  async movements(
    organizationId: string,
    productId: string,
    page: number,
    limit: number,
  ) {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, organizationId },
      select: { id: true },
    });
    if (!product) throw notFound("Product", productId);

    const where: Prisma.InventoryMovementWhereInput = { organizationId, productId };
    const [data, total] = await Promise.all([
      this.prisma.inventoryMovement.findMany({
        where,
        include: { location: true },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.inventoryMovement.count({ where }),
    ]);
    return { data, meta: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  }

  /**
   * Stock adjustment — recorded as an ADJUSTMENT (or DAMAGE) ledger movement.
   * Quantity is the signed delta (e.g. -3 for a physical stock shortfall).
   */
  async adjust(
    organizationId: string,
    input: AdjustInventoryInput,
    actor: AuthUser,
  ) {
    const location = await this.prisma.location.findFirst({
      where: { id: input.locationId, organizationId },
    });
    if (!location) throw notFound("Location", input.locationId);

    const result = await this.prisma.$transaction(async (tx) => {
      const adjustment = await tx.stockAdjustment.create({
        data: {
          organizationId,
          locationId: input.locationId,
          reason: input.reason,
          createdById: actor.id,
          notes: input.notes,
          items: {
            create: input.items.map((item) => ({
              productId: item.productId,
              quantity: item.quantity,
              reason: item.reason,
            })),
          },
        },
        include: { items: true },
      });

      const applied: { productId: string; delta: number; balance: number }[] = [];
      for (const item of adjustment.items) {
        const product = await tx.product.findFirst({
          where: { id: item.productId, organizationId },
        });
        if (!product) throw notFound("Product", item.productId);

        const movementType: MovementType =
          item.reason === "DAMAGED" ? "DAMAGE" : "ADJUSTMENT";
        const res = await this.engine.applyMovement({
          db: tx,
          organizationId,
          productId: item.productId,
          locationId: input.locationId,
          type: movementType,
          quantity: item.quantity,
          referenceType: "StockAdjustment",
          referenceId: adjustment.id,
          metadata: { reason: item.reason },
          createdById: actor.id,
          allowNegative: item.reason === "STOCK_COUNT_VARIANCE",
        });
        applied.push({ productId: item.productId, delta: item.quantity, balance: res.balance });
      }

      return { adjustment, applied };
    });

    await this.audit.log(this.prisma, {
      organizationId,
      userId: actor.id,
      action: "INVENTORY_ADJUSTED",
      entity: "StockAdjustment",
      entityId: result.adjustment.id,
      newValue: {
        reason: input.reason,
        locationId: input.locationId,
        items: input.items,
      },
      metadata: result.applied,
    });

    return result;
  }

  async summary(organizationId: string) {
    const [totalInventoryValue, lowStock, outOfStock, totalProducts] = await Promise.all([
      this.prisma.inventory.aggregate({
        where: { organizationId, quantity: { gt: 0 } },
        _sum: { quantity: true },
      }),
      this.prisma.$queryRaw<{ count: bigint }[]>`
        SELECT COUNT(*)::bigint AS count FROM "Inventory" inv
        JOIN "Product" p ON p.id = inv."productId"
        WHERE inv."organizationId" = ${organizationId}
          AND inv.quantity > 0
          AND inv.quantity <= p."reorderLevel"
      `,
      this.prisma.$queryRaw<{ count: bigint }[]>`
        SELECT COUNT(*)::bigint AS count FROM "Inventory"
        WHERE "organizationId" = ${organizationId} AND quantity <= 0
      `,
      this.prisma.product.count({ where: { organizationId } }),
    ]);

    return {
      totalProducts,
      lowStock: Number(lowStock[0]?.count ?? 0),
      outOfStock: Number(outOfStock[0]?.count ?? 0),
      totalUnits: totalInventoryValue._sum.quantity ?? 0,
    };
  }
}