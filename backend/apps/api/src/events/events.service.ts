import { Injectable, Logger } from "@nestjs/common";
import {
  Prisma,
  EventProcessingStatus,
  EventType,
  PaymentStatus,
  SaleStatus,
} from "@inv/database";
import { PrismaService } from "../prisma/prisma.service";
import { InventoryEngine } from "../inventory/inventory-engine.service";
import { TenantService } from "../common/tenant.service";
import { AuditService } from "../audit/audit.service";
import { QueueService } from "../queue/queue.service";
import {
  DomainException,
  ErrorCodes,
  notFound,
  tenantMismatch,
} from "../common/errors";
import {
  SaleEventInput,
  ReturnEventInput,
  PosEventInput,
} from "@inv/validation";
import type { AuthUser } from "../common/decorators/auth.decorator";
import { roleHasPermission, type Permission } from "@inv/config";

export interface ProcessResult {
  status: "PROCESSED" | "DUPLICATE" | "PROCESSING";
  eventId: string;
  type: EventType;
  transactionId?: string | null;
  transaction?: unknown;
  existing?: boolean;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

@Injectable()
export class EventsService {
  private readonly logger = new Logger("EventsService");

  constructor(
    private readonly prisma: PrismaService,
    private readonly engine: InventoryEngine,
    private readonly tenant: TenantService,
    private readonly audit: AuditService,
    private readonly queue: QueueService,
  ) {}

  /**
   * Idempotent event ingestion.
   *
   * 1. A TransactionEvent row is created first (eventId UNIQUE at the DB level).
   * 2. If the event already exists and was PROCESSED, the previous result is
   *    returned — no second side effect.
   * 3. If it exists but FAILED, it is reprocessed.
   * 4. The business document + inventory ledger movements are created in a
   *    single DB transaction.
   */
  async process(input: PosEventInput, actor: AuthUser): Promise<ProcessResult> {
    if (!actor.organizationId) throw tenantMismatch("Store");
    const permission: Permission = input.type === "SALE" ? "sales.create" : "returns.create";
    if (!roleHasPermission(actor.role, permission)) {
      throw new DomainException(ErrorCodes.FORBIDDEN, `Missing permission: ${permission}`, 403);
    }

    let event = await this.prisma.transactionEvent.findUnique({
      where: { eventId: input.eventId },
    });
    const organizationId = actor.organizationId;
    let ownsClaim = false;

    if (!event) {
      await this.tenant.assertStore(organizationId, input.storeId);
      try {
        event = await this.prisma.transactionEvent.create({
          data: {
            eventId: input.eventId,
            organizationId,
            storeId: input.storeId,
            terminalId: input.terminalId ?? null,
            type: input.type,
            payload: input as unknown as Prisma.InputJsonValue,
          },
        });
        ownsClaim = true;
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
          event = await this.prisma.transactionEvent.findUnique({
            where: { eventId: input.eventId },
          });
        } else {
          throw e;
        }
      }
    }

    if (!event) throw new Error("Unable to create event record");

    if (event.organizationId !== organizationId) {
      throw tenantMismatch("Event");
    }
    if (canonicalJson(event.payload) !== canonicalJson(input)) {
      throw new DomainException(
        ErrorCodes.CONFLICT,
        `Event ${input.eventId} already exists with a different payload`,
        409,
      );
    }

    if (
      event.status === EventProcessingStatus.PROCESSED ||
      event.status === EventProcessingStatus.DUPLICATE
    ) {
      return {
        status: "DUPLICATE",
        eventId: input.eventId,
        type: event.type,
        transactionId: event.transactionId,
        existing: true,
      };
    }

    if (event.status === EventProcessingStatus.RECEIVED && !ownsClaim) {
      return {
        status: "PROCESSING",
        eventId: input.eventId,
        type: event.type,
        existing: true,
      };
    }

    if (event.status === EventProcessingStatus.FAILED) {
      await this.tenant.assertStore(organizationId, input.storeId);
      const claimed = await this.prisma.transactionEvent.updateMany({
        where: { id: event.id, status: EventProcessingStatus.FAILED },
        data: { status: EventProcessingStatus.RECEIVED, error: null },
      });
      if (claimed.count === 0) {
        const current = await this.prisma.transactionEvent.findUnique({ where: { id: event.id } });
        if (
          current?.status === EventProcessingStatus.PROCESSED ||
          current?.status === EventProcessingStatus.DUPLICATE
        ) {
          return {
            status: "DUPLICATE",
            eventId: input.eventId,
            type: current.type,
            transactionId: current.transactionId,
            existing: true,
          };
        }
        return {
          status: "PROCESSING",
          eventId: input.eventId,
          type: event.type,
          existing: true,
        };
      }
      ownsClaim = true;
    }

    try {
      switch (input.type) {
        case "SALE":
          return await this.processSale(input, event.id, event.organizationId, actor);
        case "RETURN":
          return await this.processReturn(input, event.id, event.organizationId);
        default:
          throw new DomainException(ErrorCodes.BAD_REQUEST, `Unsupported event type`);
      }
    } catch (error) {
      await this.prisma.transactionEvent.updateMany({
        where: { id: event.id, status: EventProcessingStatus.RECEIVED },
        data: {
          status: EventProcessingStatus.FAILED,
          error: error instanceof Error ? error.message.slice(0, 500) : "unknown error",
        },
      }).catch((e) => this.logger.error("Failed to mark event FAILED", e));
      throw error;
    }
  }

  async processBatch(inputs: PosEventInput[], actor: AuthUser) {
    const results = [];
    for (const input of inputs) {
      try {
        results.push({ input, result: await this.process(input, actor) });
      } catch (error) {
        results.push({
          input,
          result: {
            status: "FAILED",
            eventId: input.eventId,
            type: input.type,
            error: error instanceof Error ? error.message : "unknown error",
          },
        });
      }
    }
    return results.map((r) => r.result);
  }

  private async processSale(
    input: SaleEventInput,
    eventId: string,
    eventOrgId: string,
    actor: AuthUser,
  ): Promise<ProcessResult> {
    const transaction = await this.prisma.$transaction(async (tx) => {
      // Validate tenant chain
      const store = await this.tenant.assertStore(eventOrgId, input.storeId, tx);
      const organizationId = store.organizationId;

      let terminal = null;
      if (input.terminalId) {
        terminal = await this.tenant.assertTerminal(organizationId, input.terminalId, tx);
        if (terminal.storeId !== input.storeId) {
          throw tenantMismatch("POS terminal");
        }
      }

      // Resolve products by SKU within the organization
      const skus = input.items.map((i) => i.sku);
      if (new Set(skus).size !== skus.length) {
        throw new DomainException(ErrorCodes.BAD_REQUEST, "Duplicate SKUs are not allowed in a sale", 400);
      }
      const products = await tx.product.findMany({
        where: { organizationId, sku: { in: skus }, status: "ACTIVE" },
      });
      const productBySku = new Map(products.map((p) => [p.sku, p]));
      for (const item of input.items) {
        if (!productBySku.has(item.sku)) {
          throw notFound("Product", `sku=${item.sku}`);
        }
      }

      const subtotal = input.items.reduce(
        (sum, item) => sum.add(productBySku.get(item.sku)!.sellingPrice.mul(item.quantity)),
        new Prisma.Decimal(0),
      );
      const discount = new Prisma.Decimal(0);
      const tax = new Prisma.Decimal(0);
      const total = subtotal;

      const transactionNumber = await this.generateTransactionNumber(tx, organizationId, "TXN");

      const sale = await tx.sale.create({
        data: {
          organizationId,
          storeId: input.storeId,
          terminalId: input.terminalId ?? null,
          transactionNumber,
          status: SaleStatus.COMPLETED,
          subtotal,
          discount,
          tax,
          total,
          paymentStatus: input.payment ? PaymentStatus.PAID : PaymentStatus.PENDING,
          createdById: actor.id,
          ...(input.payment
            ? {
                payments: {
                  create: {
                    method: input.payment.method,
                    amount: total,
                    status: PaymentStatus.PAID,
                  },
                },
              }
            : {}),
          items: {
            create: input.items.map((item) => {
              const product = productBySku.get(item.sku)!;
              return {
                productId: product.id,
                quantity: item.quantity,
                unitPrice: product.sellingPrice,
                discount: new Prisma.Decimal(0),
                tax: new Prisma.Decimal(0),
                total: product.sellingPrice.mul(item.quantity),
              };
            }),
          },
        },
        include: { items: true },
      });

      // Apply ledger movements — locked, inside the same transaction
      for (const item of sale.items) {
        await this.engine.applyMovement({
          db: tx,
          organizationId,
          productId: item.productId,
          locationId: input.storeId,
          type: "SALE",
          quantity: -item.quantity,
          referenceType: "Sale",
          referenceId: sale.id,
          metadata: { saleNumber: sale.transactionNumber },
          createdById: actor.id,
        });
      }

      await tx.transactionEvent.update({
        where: { id: eventId },
        data: {
          organizationId,
          storeId: input.storeId,
          terminalId: input.terminalId ?? null,
          status: EventProcessingStatus.PROCESSED,
          transactionId: sale.id,
          processedAt: new Date(),
        },
      });

      await this.audit.log(tx, {
        organizationId,
        userId: actor.id,
        action: "SALE_PROCESSED",
        entity: "Sale",
        entityId: sale.id,
        newValue: { transactionNumber, total: total.toString(), items: input.items.length },
      });

      return sale;
    });

    this.queue.enqueueLowStockCheck(transaction.organizationId);

    return {
      status: "PROCESSED",
      eventId: input.eventId,
      type: input.type,
      transactionId: transaction.id,
      transaction,
    };
  }

  private async processReturn(
    input: ReturnEventInput,
    eventId: string,
    eventOrgId: string,
  ): Promise<ProcessResult> {
    const transaction = await this.prisma.$transaction(async (tx) => {
      const store = await this.tenant.assertStore(eventOrgId, input.storeId, tx);
      const organizationId = store.organizationId;

      const skus = input.items.map((i) => i.sku);
      const products = await tx.product.findMany({
        where: { organizationId, sku: { in: skus } },
      });
      const productBySku = new Map(products.map((p) => [p.sku, p]));
      for (const item of input.items) {
        if (!productBySku.has(item.sku)) throw notFound("Product", `sku=${item.sku}`);
      }

      const returnNumber = await this.generateTransactionNumber(tx, organizationId, "RTN");
      const total = input.items.reduce((s, i) => s + i.unitPrice * i.quantity, 0);

      const saleReturn = await tx.saleReturn.create({
        data: {
          organizationId,
          storeId: input.storeId,
          saleId: input.saleId ?? null,
          returnNumber,
          status: "REQUESTED",
          reason: input.reason,
          total,
          items: {
            create: input.items.map((item) => ({
              productId: productBySku.get(item.sku)!.id,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              total: item.unitPrice * item.quantity,
            })),
          },
        },
        include: { items: true },
      });

      await tx.transactionEvent.update({
        where: { id: eventId },
        data: {
          organizationId,
          storeId: input.storeId,
          terminalId: input.terminalId ?? null,
          status: EventProcessingStatus.PROCESSED,
          transactionId: saleReturn.id,
          processedAt: new Date(),
        },
      });

      await this.audit.log(tx, {
        organizationId,
        action: "RETURN_REQUESTED",
        entity: "SaleReturn",
        entityId: saleReturn.id,
        newValue: { returnNumber, total },
      });

      return saleReturn;
    });

    return {
      status: "PROCESSED",
      eventId: input.eventId,
      type: input.type,
      transactionId: transaction.id,
      transaction,
    };
  }

  async listEvents(organizationId: string, page: number, limit: number) {
    const where: Prisma.TransactionEventWhereInput = { organizationId };
    const [data, total] = await Promise.all([
      this.prisma.transactionEvent.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.transactionEvent.count({ where }),
    ]);
    return { data, meta: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  }

  async getEvent(organizationId: string, eventId: string) {
    const event = await this.prisma.transactionEvent.findFirst({
      where: { organizationId, eventId },
    });
    if (!event) throw notFound("Event", eventId);
    return event;
  }

  private async generateTransactionNumber(
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
