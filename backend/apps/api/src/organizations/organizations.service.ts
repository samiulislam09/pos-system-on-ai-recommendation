import { Injectable } from "@nestjs/common";
import { Prisma } from "@inv/database";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { DomainException, ErrorCodes, notFound } from "../common/errors";
import { CreateOrganizationInput, UpdateOrganizationInput } from "@inv/validation";
import type { AuthUser } from "../common/decorators/auth.decorator";

@Injectable()
export class OrganizationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list() {
    return this.prisma.organization.findMany({
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { users: true, locations: true, products: true } } },
    });
  }

  async create(input: CreateOrganizationInput, user: AuthUser) {
    const org = await this.prisma.organization.create({
      data: {
        name: input.name,
        code: input.code,
        settings: (input.settings ?? undefined) as unknown as Prisma.InputJsonValue | undefined,
      },
    });
    if (user.organizationId) {
      await this.audit.log(this.prisma, {
        organizationId: org.id,
        userId: user.id,
        action: "ORGANIZATION_CREATED",
        entity: "Organization",
        entityId: org.id,
        newValue: input,
      });
    }
    return org;
  }

  async get(id: string, user: AuthUser) {
    const org = await this.prisma.organization.findUnique({ where: { id } });
    if (!org) throw notFound("Organization", id);
    if (user.role !== "SUPER_ADMIN" && org.id !== user.organizationId) {
      throw new DomainException(ErrorCodes.FORBIDDEN, "Forbidden", 403);
    }
    return org;
  }

  async update(id: string, input: UpdateOrganizationInput, user: AuthUser) {
    const org = await this.prisma.organization.findUnique({ where: { id } });
    if (!org) throw notFound("Organization", id);
    if (user.role !== "SUPER_ADMIN" && org.id !== user.organizationId) {
      throw new DomainException(ErrorCodes.FORBIDDEN, "Forbidden", 403);
    }
    const updated = await this.prisma.organization.update({
      where: { id },
      data: {
        name: input.name,
        settings: (input.settings ?? undefined) as unknown as Prisma.InputJsonValue | undefined,
      },
    });
    await this.audit.log(this.prisma, {
      organizationId: org.id,
      userId: user.id,
      action: "ORGANIZATION_UPDATED",
      entity: "Organization",
      entityId: org.id,
      oldValue: { name: org.name },
      newValue: input,
    });
    return updated;
  }
}