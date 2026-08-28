import { Injectable } from "@nestjs/common";
import { UserRole } from "@inv/database";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { DomainException, ErrorCodes, notFound } from "../common/errors";
import { CreateUserInput, UpdateUserInput } from "@inv/validation";
import { hashPassword } from "@inv/database";
import type { AuthUser } from "../common/decorators/auth.decorator";

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(organizationId: string, page: number, limit: number) {
    const [data, total] = await Promise.all([
      this.prisma.user.findMany({
        where: { organizationId },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          status: true,
          createdAt: true,
          lastLoginAt: true,
        },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.user.count({ where: { organizationId } }),
    ]);
    return { data, meta: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  }

  async create(organizationId: string, input: CreateUserInput, actor: AuthUser) {
    const email = input.email.toLowerCase();
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new DomainException(
        ErrorCodes.CONFLICT,
        "A user with this email already exists",
        409,
      );
    }
    const user = await this.prisma.user.create({
      data: {
        organizationId,
        name: input.name,
        email,
        passwordHash: await hashPassword(input.password),
        role: input.role as UserRole,
      },
      select: { id: true, name: true, email: true, role: true, status: true, createdAt: true },
    });
    await this.audit.log(this.prisma, {
      organizationId,
      userId: actor.id,
      action: "USER_CREATED",
      entity: "User",
      entityId: user.id,
      newValue: { name: user.name, email: user.email, role: user.role },
    });
    return user;
  }

  async update(organizationId: string, id: string, input: UpdateUserInput, actor: AuthUser) {
    const user = await this.prisma.user.findFirst({ where: { id, organizationId } });
    if (!user) throw notFound("User", id);

    if (input.role && user.role === UserRole.SUPER_ADMIN) {
      throw new DomainException(ErrorCodes.FORBIDDEN, "Cannot modify SUPER_ADMIN role", 403);
    }

    const data: Record<string, unknown> = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.status !== undefined) data.status = input.status;
    if (input.role !== undefined) data.role = input.role as UserRole;
    if (input.password !== undefined) data.passwordHash = await hashPassword(input.password);

    const updated = await this.prisma.user.update({
      where: { id },
      data: data as never,
      select: { id: true, name: true, email: true, role: true, status: true, createdAt: true },
    });

    await this.audit.log(this.prisma, {
      organizationId,
      userId: actor.id,
      action: input.role && input.role !== user.role ? "USER_ROLE_CHANGED" : "USER_UPDATED",
      entity: "User",
      entityId: user.id,
      oldValue: { name: user.name, role: user.role, status: user.status },
      newValue: input,
    });
    return updated;
  }
}