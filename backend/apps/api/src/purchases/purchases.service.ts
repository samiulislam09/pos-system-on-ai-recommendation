import { Injectable } from "@nestjs/common";
import { Prisma, PurchaseOrderStatus } from "@inv/database";
import { PrismaService } from "../prisma/prisma.service";
import { InventoryEngine } from "../inventory/inventory-engine.service";
import { AuditService } from "../audit/audit.service";
import { TenantService } from "../common/tenant.service";
import { invalidOperation, notFound } from "../common/errors";
import {
  CreatePurchaseOrderInput,
  CreateSupplierInput,
  ReceivePurchaseOrderInput,
} from "@inv/validation";
import type { AuthUser } from "../common/decorators/auth.decorator";

@Injectable()
export class PurchasesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly engine: InventoryEngine,
    private readonly tenant: TenantService,
    private readonly audit: AuditService,
  ) {}

  async listSuppliers(organizationId: string) {
    return this.prisma.supplier.findMany({
      where: { organizationId },
      orderBy: { name: "asc" },
      include: { _count: { select: { purchaseOrders: true } } },
    });
  }

  async createSupplier(organizationId: string, input: CreateSupplierInput, actor: AuthUser) {
    const supplier = await this.prisma.supplier.create({
      data: { organizationId, ...input },
    });
    await this.audit.log(this.prisma, {
      organizationId,
      userId: actor.id,
      action: "SUPPLIER_CREATED",
      entity: "Supplier",
      entityId: supplier.id,
      newValue: { name: supplier.name },
    });
    return supplier;
  }

  async listPurchaseOrders(organizationId: string, page: number, limit: number, status?: string) {
    const where: Prisma.PurchaseOrderWhereInput = {
      organizationId,
      ...(status ? { status: status as PurchaseOrderStatus } : {}),
    };
    const [data, total] = await Promise.all([
      this.prisma.purchaseOrder.findMany({
        where,
        include: { supplier: true, items: { include: { product: true } } },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.purchaseOrder.count({ where }),
    ]);
    return { data, meta: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  }

  async getPurchaseOrder(organizationId: string, id: string) {
    const po = await this.prisma.purchaseOrder.findFirst({
      where: { id, organizationId },
      include: {
        supplier: true,
        items: { include: { product: true } },
        goodsReceipts: { include: { items: true } },
      },
    });
    if (!po) throw notFound("Purchase order", id);
    return po;
  }

  async createPurchaseOrder(organizationId: string, input: CreatePurchaseOrderInput, actor: AuthUser) {
    await this.tenant.assertSupplier(organizationId, input.supplierId);
    if (input.locationId) {
      await this.tenant.assertLocation(organizationId, input.locationId);
    }

    const total = input.items.reduce((s, i) => s + i.unitCost * i.quantity, 0);

    const po = await this.prisma.$transaction(async (tx) => {
      for (const item of input.items) {
        await this.tenant.assertProduct(organizationId, item.productId, tx);
      }
      const poNumber = await this.generateNumber(tx, organizationId, "PO");
      const created = await tx.purchaseOrder.create({
        data: {
          organizationId,
          poNumber,
          supplierId: input.supplierId,
          locationId: input.locationId ?? "",
          status: PurchaseOrderStatus.DRAFT,
          expectedAt: input.expectedAt ? new Date(input.expectedAt) : null,
          notes: input.notes,
          totalAmount: total,
          createdById: actor.id,
          items: {
            create: input.items.map((i) => ({
              productId: i.productId,
              quantity: i.quantity,
              receivedQuantity: 0,
              unitCost: i.unitCost,
              total: i.unitCost * i.quantity,
            })),
          },
        },
        include: { items: true, supplier: true },
      });
      await this.audit.log(tx, {
        organizationId,
        userId: actor.id,
        action: "PURCHASE_ORDER_CREATED",
        entity: "PurchaseOrder",
        entityId: created.id,
        newValue: { poNumber, total },
      });
      return created;
    });

    return po;
  }

  /**
   * Inventory increases only when goods are physically received (§15).
   * Creates a GoodsReceipt + PURCHASE ledger movements in one transaction.
   */
  async receivePurchaseOrder(organizationId: string, id: string, input: ReceivePurchaseOrderInput, actor: AuthUser) {
    const po = await this.tenant.assertPurchaseOrder(organizationId, id);
    if (po.status === PurchaseOrderStatus.CANCELLED) {
      throw invalidOperation("Cannot receive a cancelled purchase order");
    }
    await this.tenant.assertLocation(organizationId, input.locationId);

    return this.prisma.$transaction(async (tx) => {
      const poFull = await tx.purchaseOrder.findUniqueOrThrow({
        where: { id },
        include: { items: true },
      });

      const itemMap = new Map(poFull.items.map((i) => [i.id, i]));
      const receiptNumber = await this.generateNumber(tx, organizationId, "GRN");

      let totalReceipt = 0;
      const receivedRows: { itemId: string; productId: string; quantity: number; unitCost: Prisma.Decimal }[] = [];
      const seenItemIds = new Set<string>();
      const projectedQuantities = new Map(poFull.items.map((item) => [item.id, item.receivedQuantity]));

      for (const item of input.items) {
        if (seenItemIds.has(item.purchaseOrderItemId)) {
          throw invalidOperation("Each purchase order item must be supplied exactly once per receipt");
        }
        seenItemIds.add(item.purchaseOrderItemId);
        const poItem = itemMap.get(item.purchaseOrderItemId);
        if (!poItem) throw notFound("Purchase order item", item.purchaseOrderItemId);
        const newReceived = poItem.receivedQuantity + item.quantity;
        if (newReceived > poItem.quantity) {
          throw invalidOperation(
            `Receiving ${item.quantity} for item would exceed ordered quantity ${poItem.quantity}`,
          );
        }
        if (item.productId !== poItem.productId) {
          throw invalidOperation("Received product does not match the purchase order item");
        }
        projectedQuantities.set(poItem.id, newReceived);
        totalReceipt += item.quantity * Number(poItem.unitCost);
        receivedRows.push({
          itemId: poItem.id,
          productId: poItem.productId,
          quantity: item.quantity,
          unitCost: poItem.unitCost,
        });
      }

      const receipt = await tx.goodsReceipt.create({
        data: {
          organizationId,
          purchaseOrderId: id,
          locationId: input.locationId,
          receiptNumber,
          receivedById: actor.id,
          notes: input.notes,
          items: {
            create: receivedRows.map((r) => ({
              purchaseOrderItemId: r.itemId,
              productId: r.productId,
              quantity: r.quantity,
              unitCost: r.unitCost,
              total: r.unitCost.mul(r.quantity),
            })),
          },
        },
        include: { items: true },
      });

      for (const row of receivedRows) {
        await tx.purchaseOrderItem.update({
          where: { id: row.itemId },
          data: { receivedQuantity: { increment: row.quantity } },
        });
        await this.engine.applyMovement({
          db: tx,
          organizationId,
          productId: row.productId,
          locationId: input.locationId,
          type: "PURCHASE",
          quantity: row.quantity,
          referenceType: "GoodsReceipt",
          referenceId: receipt.id,
          metadata: { poNumber: po.poNumber, receiptNumber },
          createdById: actor.id,
        });
      }

      const allReceived = poFull.items.every(
        (i) => (projectedQuantities.get(i.id) ?? i.receivedQuantity) >= i.quantity,
      );
      const newStatus = allReceived
        ? PurchaseOrderStatus.RECEIVED
        : PurchaseOrderStatus.PARTIALLY_RECEIVED;

      const updatedPo = await tx.purchaseOrder.update({
        where: { id },
        data: { status: newStatus },
      });

      await this.audit.log(tx, {
        organizationId,
        userId: actor.id,
        action: "PURCHASE_RECEIVED",
        entity: "PurchaseOrder",
        entityId: po.id,
        oldValue: { status: po.status },
        newValue: { status: newStatus, receiptNumber },
      });

      return { receipt, purchaseOrder: updatedPo };
    });
  }

  private async generateNumber(
    tx: Prisma.TransactionClient,
    organizationId: string,
    prefix: string,
  ): Promise<string> {
    const org = await tx.organization.findUnique({
      where: { id: organizationId },
      select: { code: true },
    });
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const suffix = Math.random().toString(36).slice(2, 8).toUpperCase();
    return `${prefix}-${org?.code ?? "ORG"}-${date}-${suffix}`;
  }
}
