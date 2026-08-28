import { Controller, Get, Query } from "@nestjs/common";
import { paginationSchema } from "@inv/validation";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { PrismaService } from "../prisma/prisma.service";
import {
  CurrentUser,
  RequirePermission,
  type AuthUser,
} from "../common/decorators/auth.decorator";

@Controller("audit")
export class AuditController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @RequirePermission("audit.read")
  async list(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(paginationSchema)) query: { page: number; limit: number },
    @Query("action") action?: string,
    @Query("entity") entity?: string,
  ) {
    const where = {
      organizationId: user.organizationId!,
      ...(action ? { action } : {}),
      ...(entity ? { entity } : {}),
    };
    const [data, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        include: { user: { select: { id: true, name: true, email: true } } },
        orderBy: { createdAt: "desc" },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    return { data, meta: { page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) } };
  }
}