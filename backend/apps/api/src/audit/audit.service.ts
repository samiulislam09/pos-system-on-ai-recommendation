import { Injectable } from "@nestjs/common";
import { Prisma, PrismaClient } from "@inv/database";

export interface AuditParams {
  organizationId: string;
  userId?: string | null;
  action: string;
  entity: string;
  entityId: string;
  oldValue?: unknown;
  newValue?: unknown;
  metadata?: unknown;
  ipAddress?: string;
  userAgent?: string;
}

@Injectable()
export class AuditService {
  async log(
    db: PrismaClient | Prisma.TransactionClient,
    params: AuditParams,
  ): Promise<void> {
    await db.auditLog.create({
      data: {
        organizationId: params.organizationId,
        userId: params.userId ?? null,
        action: params.action,
        entity: params.entity,
        entityId: params.entityId,
        oldValue: params.oldValue === undefined ? undefined : (params.oldValue as Prisma.InputJsonValue),
        newValue: params.newValue === undefined ? undefined : (params.newValue as Prisma.InputJsonValue),
        metadata: params.metadata === undefined ? undefined : (params.metadata as Prisma.InputJsonValue),
        ipAddress: params.ipAddress,
        userAgent: params.userAgent,
      },
    });
  }
}