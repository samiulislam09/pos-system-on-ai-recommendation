import { Injectable } from "@nestjs/common";
import { Prisma, TransferStatus } from "@inv/database";
import { PrismaService } from "../prisma/prisma.service";
import { InventoryEngine } from "../inventory/inventory-engine.service";
import { AuditService } from "../audit/audit.service";
import { invalidOperation, notFound } from "../common/errors";
import { CreateTransferInput, ReceiveTransferInput } from "@inv/validation";
import type { AuthUser } from "../common/decorators/auth.decorator";

const VALID_TRANSITIONS: Record<TransferStatus, TransferStatus[]> = {
  DRAFT: ["PENDING", "CANCELLED"],
  PENDING: ["APPROVED", "CANCELLED"],
  APPROVED: ["IN_TRANSIT", "CANCELLED"],
  IN_TRANSIT: ["RECEIVED"],
  RECEIVED: [],
  CANCELLED: [],
};

@Injectable()
export class TransfersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly engine: InventoryEngine,
    private readonly audit: AuditService,
  ) {}

  async list(organizationId: string, page: number, limit: number, status?: string) {
    const where: Prisma.StockTransferWhereInput = {
      organizationId,
      ...(status ? { status: status as TransferStatus } : {}),
    };
    const [data, total] = await Promise.all([
      this.prisma.stockTransfer.findMany({
        where,
        include: {
          sourceLocation: true,
          destinationLocation: true,
          items: { include: { product: true } },
        },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.stockTransfer.count({ where }),
    ]);
    return { data, meta: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  }

  async get(organizationId: string, id: string) {
    const transfer = await this.prisma.stockTransfer.findFirst({
      where: { id, organizationId },
      include: {
        sourceLocation: true,
        destinationLocation: true,
        items: { include: { product: true } },
      },
    });
    if (!transfer) throw notFound("Transfer", id);
    return transfer;
  }

  async create(organizationId: string, input: CreateTransferInput, actor: AuthUser) {
    if (input.sourceLocationId === input.destinationLocationId) {
      throw invalidOperation("Source and destination must differ");
    }
    const source = await this.prisma.location.findFirst({
      where: { id: input.sourceLocationId, organizationId },
    });
    if (!source) throw notFound("Location", input.sourceLocationId);
    const destination = await this.prisma.location.findFirst({
      where: { id: input.destinationLocationId, organizationId },
    });
    if (!destination) throw notFound("Location", input.destinationLocationId);

    return this.prisma.$transaction(async (tx) => {
      for (const item of input.items) {
        const product = await tx.product.findFirst({
          where: { id: item.productId, organizationId },
        });
        if (!product) throw notFound("Product", item.productId);
      }
      const transferNumber = await this.generateNumber(tx, organizationId, "TRF");
      const transfer = await tx.stockTransfer.create({
        data: {
          organizationId,
          transferNumber,
          sourceLocationId: input.sourceLocationId,
          destinationLocationId: input.destinationLocationId,
          status: TransferStatus.PENDING,
          createdById: actor.id,
          notes: input.notes,
          items: {
            create: input.items.map((i) => ({
              productId: i.productId,
              quantity: i.quantity,
              receivedQuantity: 0,
            })),
          },
        },
        include: { items: true, sourceLocation: true, destinationLocation: true },
      });
      await this.audit.log(tx, {
        organizationId,
        userId: actor.id,
        action: "TRANSFER_CREATED",
        entity: "StockTransfer",
        entityId: transfer.id,
        newValue: { transferNumber, source: source.code, destination: destination.code },
      });
      return transfer;
    });
  }

  async approve(organizationId: string, id: string, actor: AuthUser) {
    return this.transition(organizationId, id, TransferStatus.APPROVED, actor, "TRANSFER_APPROVED");
  }

  async ship(organizationId: string, id: string, actor: AuthUser) {
    return this.prisma.$transaction(async (tx) => {
      const transfer = await tx.stockTransfer.findFirst({
        where: { id, organizationId },
        include: { items: true },
      });
      if (!transfer) throw notFound("Transfer", id);
      this.assertTransition(transfer.status, TransferStatus.IN_TRANSIT);

      for (const item of transfer.items) {
        await this.engine.applyMovement({
          db: tx,
          organizationId,
          productId: item.productId,
          locationId: transfer.sourceLocationId,
          type: "TRANSFER_OUT",
          quantity: -item.quantity,
          referenceType: "StockTransfer",
          referenceId: transfer.id,
          metadata: { transferNumber: transfer.transferNumber },
          createdById: actor.id,
        });
      }

      const updated = await tx.stockTransfer.update({
        where: { id },
        data: { status: TransferStatus.IN_TRANSIT, shippedById: actor.id, shippedAt: new Date() },
        include: { items: true },
      });

      await this.audit.log(tx, {
        organizationId,
        userId: actor.id,
        action: "TRANSFER_SHIPPED",
        entity: "StockTransfer",
        entityId: transfer.id,
        oldValue: { status: transfer.status },
        newValue: { status: TransferStatus.IN_TRANSIT },
      });

      return updated;
    });
  }

  async receive(organizationId: string, id: string, input: ReceiveTransferInput, actor: AuthUser) {
    return this.prisma.$transaction(async (tx) => {
      const transfer = await tx.stockTransfer.findFirst({
        where: { id, organizationId },
        include: { items: true },
      });
      if (!transfer) throw notFound("Transfer", id);
      if (transfer.status !== TransferStatus.IN_TRANSIT) {
        throw invalidOperation("Only an in-transit transfer can be received");
      }

      const byId = new Map(input.items.map((i) => [i.transferItemId, i.quantity]));
      if (byId.size !== input.items.length) {
        throw invalidOperation("Each transfer item must be supplied exactly once");
      }
      if (byId.size !== transfer.items.length || input.items.some((item) => !transfer.items.some((row) => row.id === item.transferItemId))) {
        throw invalidOperation("All and only the shipped transfer items must be received");
      }
      for (const item of transfer.items) {
        const qty = byId.get(item.id);
        if (qty !== item.quantity) {
          throw invalidOperation(
            `Item ${item.id} must be received with its full shipped quantity of ${item.quantity}`,
          );
        }
        await this.engine.applyMovement({
          db: tx,
          organizationId,
          productId: item.productId,
          locationId: transfer.destinationLocationId,
          type: "TRANSFER_IN",
          quantity: qty,
          referenceType: "StockTransfer",
          referenceId: transfer.id,
          metadata: { transferNumber: transfer.transferNumber },
          createdById: actor.id,
        });
        await tx.stockTransferItem.update({
          where: { id: item.id },
          data: { receivedQuantity: { increment: qty } },
        });
      }

      const updated = await tx.stockTransfer.update({
        where: { id },
        data: { status: TransferStatus.RECEIVED, receivedById: actor.id, receivedAt: new Date() },
        include: { items: true },
      });

      await this.audit.log(tx, {
        organizationId,
        userId: actor.id,
        action: "TRANSFER_RECEIVED",
        entity: "StockTransfer",
        entityId: transfer.id,
        oldValue: { status: transfer.status },
        newValue: { status: TransferStatus.RECEIVED },
      });

      return updated;
    });
  }

  async cancel(organizationId: string, id: string, actor: AuthUser) {
    return this.transition(organizationId, id, TransferStatus.CANCELLED, actor, "TRANSFER_CANCELLED");
  }

  private async transition(
    organizationId: string,
    id: string,
    next: TransferStatus,
    actor: AuthUser,
    action: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const transfer = await tx.stockTransfer.findFirst({
        where: { id, organizationId },
      });
      if (!transfer) throw notFound("Transfer", id);
      this.assertTransition(transfer.status, next);

      const data: Prisma.StockTransferUpdateInput = { status: next };
      if (next === TransferStatus.APPROVED) data.approvedById = actor.id, data.approvedAt = new Date();
      if (next === TransferStatus.CANCELLED) data.cancelledAt = new Date();

      const updated = await tx.stockTransfer.update({ where: { id }, data });
      await this.audit.log(tx, {
        organizationId,
        userId: actor.id,
        action,
        entity: "StockTransfer",
        entityId: transfer.id,
        oldValue: { status: transfer.status },
        newValue: { status: next },
      });
      return updated;
    });
  }

  private assertTransition(from: TransferStatus, to: TransferStatus) {
    if (!VALID_TRANSITIONS[from].includes(to)) {
      throw invalidOperation(`Cannot transition transfer from ${from} to ${to}`);
    }
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
