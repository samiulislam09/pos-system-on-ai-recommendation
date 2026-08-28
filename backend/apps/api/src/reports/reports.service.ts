import { Injectable } from "@nestjs/common";
import { Prisma } from "@inv/database";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async overview(organizationId: string) {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const [todaySales, todayTx, inventory, lowStock, outOfStock, stores, pendingTransfers, failedSync] =
      await Promise.all([
        this.prisma.sale.aggregate({
          where: { organizationId, createdAt: { gte: todayStart }, status: "COMPLETED" },
          _sum: { total: true },
          _count: true,
        }),
        this.prisma.transactionEvent.count({
          where: { organizationId, createdAt: { gte: todayStart } },
        }),
        this.inventoryValue(organizationId),
        this.prisma.$queryRaw<{ count: bigint }[]>`
          SELECT COUNT(*)::bigint AS count FROM "Inventory" inv
          JOIN "Product" p ON p.id = inv."productId"
          WHERE inv."organizationId" = ${organizationId}
            AND inv.quantity > 0 AND inv.quantity <= p."reorderLevel"
        `,
        this.prisma.$queryRaw<{ count: bigint }[]>`
          SELECT COUNT(*)::bigint AS count FROM "Inventory"
          WHERE "organizationId" = ${organizationId} AND quantity <= 0
        `,
        this.prisma.location.count({ where: { organizationId, status: "ACTIVE", type: "STORE" } }),
        this.prisma.stockTransfer.count({
          where: { organizationId, status: { in: ["PENDING", "APPROVED", "IN_TRANSIT"] } },
        }),
        this.prisma.transactionEvent.count({
          where: { organizationId, status: "FAILED" },
        }),
      ]);

    return {
      todaySales: todaySales._sum.total ?? 0,
      todayTransactions: todaySales._count,
      todayEvents: todayTx,
      totalInventoryValue: inventory.totalValue,
      totalUnits: inventory.totalUnits,
      lowStock: Number(lowStock[0]?.count ?? 0),
      outOfStock: Number(outOfStock[0]?.count ?? 0),
      activeStores: stores,
      pendingTransfers,
      failedEvents: failedSync,
    };
  }

  async salesByDay(organizationId: string, from: Date, to: Date) {
    const rows = await this.prisma.$queryRaw<{
      day: Date;
      total: Prisma.Decimal;
      transactions: bigint;
    }[]>`
      SELECT date_trunc('day', "createdAt")::date AS day,
             COALESCE(SUM(total), 0)::numeric(12,2) AS total,
             COUNT(*)::bigint AS transactions
      FROM "Sale"
      WHERE "organizationId" = ${organizationId}
        AND status = 'COMPLETED'
        AND "createdAt" >= ${from} AND "createdAt" <= ${to}
      GROUP BY day
      ORDER BY day ASC
    `;
    return rows.map((r) => ({
      day: r.day.toISOString().slice(0, 10),
      total: Number(r.total),
      transactions: Number(r.transactions),
    }));
  }

  async salesByStore(organizationId: string, from: Date, to: Date) {
    const rows = await this.prisma.$queryRaw<{
      storeId: string;
      name: string;
      total: Prisma.Decimal;
      transactions: bigint;
    }[]>`
      SELECT s."storeId", l.name,
             COALESCE(SUM(s.total), 0)::numeric(12,2) AS total,
             COUNT(*)::bigint AS transactions
      FROM "Sale" s
      JOIN "Location" l ON l.id = s."storeId"
      WHERE s."organizationId" = ${organizationId}
        AND s.status = 'COMPLETED'
        AND s."createdAt" >= ${from} AND s."createdAt" <= ${to}
      GROUP BY s."storeId", l.name
      ORDER BY total DESC
    `;
    return rows.map((r) => ({
      storeId: r.storeId,
      name: r.name,
      total: Number(r.total),
      transactions: Number(r.transactions),
    }));
  }

  async topProducts(organizationId: string, from: Date, to: Date, limit = 10) {
    const rows = await this.prisma.$queryRaw<{
      productId: string;
      sku: string;
      name: string;
      quantity: bigint;
      revenue: Prisma.Decimal;
    }[]>`
      SELECT si."productId", p.sku, p.name,
             SUM(si.quantity)::bigint AS quantity,
             COALESCE(SUM(si.total), 0)::numeric(12,2) AS revenue
      FROM "SaleItem" si
      JOIN "Sale" s ON s.id = si."saleId"
      JOIN "Product" p ON p.id = si."productId"
      WHERE s."organizationId" = ${organizationId}
        AND s.status = 'COMPLETED'
        AND s."createdAt" >= ${from} AND s."createdAt" <= ${to}
      GROUP BY si."productId", p.sku, p.name
      ORDER BY quantity DESC
      LIMIT ${limit}
    `;
    return rows.map((r) => ({
      productId: r.productId,
      sku: r.sku,
      name: r.name,
      quantity: Number(r.quantity),
      revenue: Number(r.revenue),
    }));
  }

  async inventoryReport(organizationId: string, locationId?: string) {
    const rows = await this.prisma.inventory.findMany({
      where: {
        organizationId,
        ...(locationId ? { locationId } : {}),
      },
      include: { product: { include: { brand: true, category: true } }, location: true },
      orderBy: { product: { name: "asc" } },
    });

    return rows.map((r) => ({
      productId: r.productId,
      sku: r.product.sku,
      name: r.product.name,
      location: r.location.name,
      locationCode: r.location.code,
      quantity: r.quantity,
      reservedQuantity: r.reservedQuantity,
      availableQuantity: r.quantity - r.reservedQuantity,
      reorderLevel: r.product.reorderLevel,
      costPrice: r.product.costPrice,
      sellingPrice: r.product.sellingPrice,
      stockStatus:
        r.quantity <= 0
          ? "OUT_OF_STOCK"
          : r.quantity <= r.product.reorderLevel
            ? "LOW_STOCK"
            : "IN_STOCK",
    }));
  }

  async movementReport(organizationId: string, from: Date, to: Date, type?: string) {
    const where: Prisma.InventoryMovementWhereInput = {
      organizationId,
      createdAt: { gte: from, lte: to },
      ...(type ? { type: type as never } : {}),
    };
    const [data, summary] = await Promise.all([
      this.prisma.inventoryMovement.findMany({
        where,
        include: { product: { select: { sku: true, name: true } }, location: true },
        orderBy: { createdAt: "desc" },
        take: 500,
      }),
      this.prisma.inventoryMovement.groupBy({
        by: ["type"],
        where,
        _sum: { quantity: true },
      }),
    ]);
    return { movements: data, summary };
  }

  async adjustmentReport(organizationId: string, from: Date, to: Date) {
    return this.prisma.stockAdjustment.findMany({
      where: {
        organizationId,
        createdAt: { gte: from, lte: to },
      },
      include: { items: { include: { product: true } }, location: true },
      orderBy: { createdAt: "desc" },
    });
  }

  async purchaseReport(organizationId: string, from: Date, to: Date) {
    return this.prisma.purchaseOrder.findMany({
      where: { organizationId, createdAt: { gte: from, lte: to } },
      include: { supplier: true, items: { include: { product: true } }, goodsReceipts: true },
      orderBy: { createdAt: "desc" },
    });
  }

  async transferReport(organizationId: string, from: Date, to: Date) {
    return this.prisma.stockTransfer.findMany({
      where: { organizationId, createdAt: { gte: from, lte: to } },
      include: {
        sourceLocation: true,
        destinationLocation: true,
        items: { include: { product: true } },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  async returnReport(organizationId: string, from: Date, to: Date) {
    return this.prisma.saleReturn.findMany({
      where: { organizationId, createdAt: { gte: from, lte: to } },
      include: { items: { include: { product: true } }, store: true },
      orderBy: { createdAt: "desc" },
    });
  }

  private async inventoryValue(organizationId: string) {
    const rows = await this.prisma.$queryRaw<{ value: Prisma.Decimal; units: bigint }[]>`
      SELECT COALESCE(SUM(inv.quantity * p."costPrice"), 0)::numeric(12,2) AS value,
             COALESCE(SUM(inv.quantity), 0)::bigint AS units
      FROM "Inventory" inv
      JOIN "Product" p ON p.id = inv."productId"
      WHERE inv."organizationId" = ${organizationId}
    `;
    return {
      totalValue: Number(rows[0]?.value ?? 0),
      totalUnits: Number(rows[0]?.units ?? 0),
    };
  }
}