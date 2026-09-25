import { Injectable } from "@nestjs/common";
import { Prisma, UserRole, VendorNotificationType } from "@inv/database";
import { PERMISSIONS, ROLE_PERMISSIONS } from "@inv/config";
import { PrismaService } from "../prisma/prisma.service";
import { notFound } from "../common/errors";
import type { AuthUser } from "../common/decorators/auth.decorator";
import { NotificationStream } from "./notification-stream.service";

/** Staff roles that review supplier uploads, and so hear about submissions. */
export const REVIEWER_ROLES = (Object.keys(ROLE_PERMISSIONS) as UserRole[]).filter((role) =>
  ROLE_PERMISSIONS[role].includes(PERMISSIONS.supplier_uploads_manage),
);

/** A notification written inside a transaction, to announce once it commits. */
export interface PendingVendorAlert {
  recipientIds: string[];
  message: string;
}

/**
 * Staff-side notifications: tell the organization's upload reviewers when a
 * supplier sends work for review.
 */
@Injectable()
export class VendorNotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stream: NotificationStream,
  ) {}

  /**
   * Write one notification per active reviewer in the organization. Call
   * inside the supplier's transaction, then `announce` the result after commit.
   */
  async createForUpload(
    tx: Prisma.TransactionClient,
    input: { organizationId: string; uploadId: string; type: VendorNotificationType; message: string },
  ): Promise<PendingVendorAlert> {
    const reviewers = await tx.user.findMany({
      where: {
        organizationId: input.organizationId,
        status: "ACTIVE",
        role: { in: REVIEWER_ROLES },
      },
      select: { id: true },
    });
    if (reviewers.length > 0) {
      await tx.vendorNotification.createMany({
        data: reviewers.map((r) => ({ ...input, userId: r.id })),
      });
    }
    return { recipientIds: reviewers.map((r) => r.id), message: input.message };
  }

  /** Push committed notifications to the recipients' open browsers. */
  announce(alert: PendingVendorAlert | undefined) {
    for (const recipientId of alert?.recipientIds ?? []) {
      this.stream.publish({ audience: "staff", recipientId, message: alert!.message });
    }
  }

  async list(user: AuthUser) {
    const where = { userId: user.id };
    const [data, unread] = await Promise.all([
      this.prisma.vendorNotification.findMany({
        where,
        include: {
          upload: {
            select: {
              id: true,
              originalName: true,
              status: true,
              supplierUser: { select: { name: true } },
            },
          },
        },
        orderBy: { createdAt: "desc" },
        take: 100,
      }),
      this.prisma.vendorNotification.count({ where: { ...where, readAt: null } }),
    ]);
    return { data, unread };
  }

  async markRead(user: AuthUser, id: string) {
    const { count } = await this.prisma.vendorNotification.updateMany({
      where: { id, userId: user.id, readAt: null },
      data: { readAt: new Date() },
    });
    if (count === 0) {
      const exists = await this.prisma.vendorNotification.count({ where: { id, userId: user.id } });
      if (!exists) throw notFound("Notification", id);
    }
    this.stream.publish({ audience: "staff", recipientId: user.id });
    return { success: true };
  }

  async markAllRead(user: AuthUser) {
    const { count } = await this.prisma.vendorNotification.updateMany({
      where: { userId: user.id, readAt: null },
      data: { readAt: new Date() },
    });
    this.stream.publish({ audience: "staff", recipientId: user.id });
    return { marked: count };
  }
}
