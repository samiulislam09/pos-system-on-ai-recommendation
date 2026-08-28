import { Injectable } from "@nestjs/common";
import { LocationType, Prisma } from "@inv/database";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { notFound, tenantMismatch } from "../common/errors";
import { CreateLocationInput, UpdateLocationInput } from "@inv/validation";
import type { AuthUser } from "../common/decorators/auth.decorator";

@Injectable()
export class StoresService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(organizationId: string, type?: LocationType) {
    return this.prisma.location.findMany({
      where: { organizationId, ...(type ? { type } : {}) },
      orderBy: { createdAt: "desc" },
      include: {
        _count: { select: { postTerminals: true, sales: true } },
      },
    });
  }

  async get(organizationId: string, id: string) {
    const location = await this.prisma.location.findFirst({
      where: { id, organizationId },
      include: {
        postTerminals: true,
        inventory: { include: { product: true }, take: 20 },
      },
    });
    if (!location) throw notFound("Location", id);

    const [sales, transfersIn, transfersOut, pendingTransfersIn] = await Promise.all([
      this.prisma.sale.findMany({
        where: { storeId: id },
        include: { terminal: { select: { terminalCode: true } } },
        orderBy: { createdAt: "desc" },
        take: 10,
      }),
      this.prisma.stockTransfer.findMany({
        where: { destinationLocationId: id },
        include: { sourceLocation: { select: { name: true } } },
        orderBy: { createdAt: "desc" },
        take: 10,
      }),
      this.prisma.stockTransfer.findMany({
        where: { sourceLocationId: id },
        include: { destinationLocation: { select: { name: true } } },
        orderBy: { createdAt: "desc" },
        take: 10,
      }),
      this.prisma.stockTransfer.count({
        where: { destinationLocationId: id, status: { in: ["PENDING", "APPROVED", "IN_TRANSIT"] } },
      }),
    ]);

    return {
      ...location,
      sales,
      transfersIn: transfersIn.map((t) => ({ ...t, source: t.sourceLocation })),
      transfersOut: transfersOut.map((t) => ({ ...t, destination: t.destinationLocation })),
      pendingTransfersIn,
    };
  }

  async create(organizationId: string, input: CreateLocationInput, actor: AuthUser) {
    const location = await this.prisma.location.create({
      data: {
        organizationId,
        name: input.name,
        code: input.code,
        type: input.type as LocationType,
        address: input.address,
        settings: input.settings as Prisma.InputJsonValue | undefined,
      },
    });
    await this.audit.log(this.prisma, {
      organizationId,
      userId: actor.id,
      action: input.type === "WAREHOUSE" ? "WAREHOUSE_CREATED" : "STORE_CREATED",
      entity: "Location",
      entityId: location.id,
      newValue: input,
    });
    return location;
  }

  async update(organizationId: string, id: string, input: UpdateLocationInput, actor: AuthUser) {
    const location = await this.prisma.location.findFirst({ where: { id, organizationId } });
    if (!location) throw notFound("Location", id);
    const updated = await this.prisma.location.update({
      where: { id },
      data: {
        name: input.name,
        address: input.address,
        status: input.status,
        settings: input.settings as Prisma.InputJsonValue | undefined,
      },
    });
    await this.audit.log(this.prisma, {
      organizationId,
      userId: actor.id,
      action: "STORE_UPDATED",
      entity: "Location",
      entityId: location.id,
      oldValue: { name: location.name, status: location.status },
      newValue: input,
    });
    return updated;
  }

  async createTerminal(organizationId: string, input: { storeId: string; terminalCode: string }, actor: AuthUser) {
    const store = await this.prisma.location.findFirst({
      where: { id: input.storeId, organizationId, type: "STORE" },
    });
    if (!store) throw tenantMismatch("Store");

    const terminal = await this.prisma.postTerminal.create({
      data: {
        organizationId,
        storeId: input.storeId,
        terminalCode: input.terminalCode,
      },
    });
    await this.audit.log(this.prisma, {
      organizationId,
      userId: actor.id,
      action: "POS_TERMINAL_CREATED",
      entity: "PostTerminal",
      entityId: terminal.id,
      newValue: input,
    });
    return terminal;
  }

  async listTerminals(organizationId: string, storeId?: string) {
    return this.prisma.postTerminal.findMany({
      where: { organizationId, ...(storeId ? { storeId } : {}) },
      orderBy: { createdAt: "desc" },
    });
  }

  async updateTerminal(organizationId: string, id: string, input: { status?: string }, actor: AuthUser) {
    const terminal = await this.prisma.postTerminal.findFirst({
      where: { id, organizationId },
    });
    if (!terminal) throw notFound("POS terminal", id);
    const updated = await this.prisma.postTerminal.update({
      where: { id },
      data: { status: input.status as never },
    });
    await this.audit.log(this.prisma, {
      organizationId,
      userId: actor.id,
      action: "POS_TERMINAL_UPDATED",
      entity: "PostTerminal",
      entityId: terminal.id,
      oldValue: { status: terminal.status },
      newValue: input,
    });
    return updated;
  }
}