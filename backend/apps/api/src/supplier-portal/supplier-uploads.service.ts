import { Injectable } from "@nestjs/common";
import { Prisma, SupplierItemEtlStatus, SupplierUploadStatus } from "@inv/database";
import { PrismaService } from "../prisma/prisma.service";
import { DomainException, ErrorCodes, invalidOperation, notFound } from "../common/errors";
import { parseShipmentCsv, type ParsedShipmentRow, type RowIssue } from "./csv";
import { findEmptyColumns } from "./etl.util";
import { lockUpload, syncUploadStatus } from "./upload-status.util";
import type {
  ResubmitIncompleteItemsInput,
  ResubmitWithEditsInput,
  SupplierUploadInput,
} from "@inv/validation";
import type { SupplierAuthUser } from "./supplier-auth.decorator";
import { NotificationStream } from "./notification-stream.service";
import { VendorNotificationsService, type PendingVendorAlert } from "./vendor-notifications.service";

/** Returned rows are only actionable while their upload is still live. */
const LIVE_UPLOAD_STATUSES = [SupplierUploadStatus.PENDING, SupplierUploadStatus.INCOMPLETE];

/**
 * Rows waiting for this supplier's correction: rows the vendor sent back from
 * a live upload, plus rows ETL flagged (or that were sent back) in a file the
 * vendor then rejected as a whole.
 */
function awaitingSupplierWhere(supplierUserId: string): Prisma.SupplierUploadItemWhereInput {
  return {
    OR: [
      {
        etlStatus: SupplierItemEtlStatus.RETURNED,
        upload: { supplierUserId, status: { in: LIVE_UPLOAD_STATUSES } },
      },
      {
        etlStatus: { in: [SupplierItemEtlStatus.RETURNED, SupplierItemEtlStatus.INCOMPLETE] },
        upload: { supplierUserId, status: SupplierUploadStatus.REJECTED },
      },
    ],
  };
}

@Injectable()
export class SupplierUploadsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationStream: NotificationStream,
    private readonly vendorNotifications: VendorNotificationsService,
  ) {}

  /** Refresh this supplier's other open tabs after they change their own data. */
  private notifyChanged(supplier: SupplierAuthUser) {
    this.notificationStream.publish({ audience: "supplier", recipientId: supplier.id });
  }

  async profile(supplier: SupplierAuthUser) {
    const [uploads, unread, returnedItems] = await Promise.all([
      this.prisma.supplierUpload.count({ where: { supplierUserId: supplier.id } }),
      this.prisma.supplierNotification.count({ where: { supplierUserId: supplier.id, readAt: null } }),
      this.prisma.supplierUploadItem.count({ where: awaitingSupplierWhere(supplier.id) }),
    ]);
    const byStatus = await this.prisma.supplierUpload.groupBy({
      by: ["status"],
      where: { supplierUserId: supplier.id },
      _count: { _all: true },
    });
    const supplierRow = supplier.supplierId
      ? await this.prisma.supplier.findUnique({
          where: { id: supplier.supplierId },
          select: { name: true, phone: true, email: true, address: true },
        })
      : null;
    return {
      user: { id: supplier.id, name: supplier.name, email: supplier.email },
      company: supplierRow,
      report: {
        totalUploads: uploads,
        unreadNotifications: unread,
        returnedItems,
        counts: Object.fromEntries(byStatus.map((r) => [r.status, r._count._all])),
      },
    };
  }

  async listMyUploads(
    supplier: SupplierAuthUser,
    page: number,
    limit: number,
    status?: SupplierUploadStatus,
  ) {
    const where = {
      supplierUserId: supplier.id,
      ...(status ? { status } : {}),
    };
    const [data, total] = await Promise.all([
      this.prisma.supplierUpload.findMany({
        where,
        include: {
          location: { select: { id: true, name: true, type: true } },
          _count: { select: { items: true, notifications: true } },
        },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.supplierUpload.count({ where }),
    ]);
    return { data, meta: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  }

  async getMyUpload(supplier: SupplierAuthUser, id: string) {
    const upload = await this.prisma.supplierUpload.findFirst({
      where: { id, supplierUserId: supplier.id },
      include: {
        location: { select: { id: true, name: true, type: true } },
        items: { orderBy: { id: "asc" }, include: { stockedLocation: { select: { id: true, name: true } } } },
        notifications: { orderBy: { createdAt: "desc" } },
      },
    });
    if (!upload) throw notFound("Supplier upload", id);
    return upload;
  }

  /**
   * Supplier uploads a product CSV. It is parsed and validated up front so the
   * supplier immediately sees which rows/columns are incomplete, then goes
   * straight to the vendor's review queue. Rows with empty or duplicate values
   * are flagged but not blocked — the vendor's ETL step sorts them.
   */
  async createUpload(supplier: SupplierAuthUser, input: SupplierUploadInput) {
    const parsed = parseShipmentCsv(input.fileName, input.content);
    if (parsed.rows.length === 0) {
      throw invalidOperation("The file contains no product rows");
    }

    const auto = await this.autoResolveMissing(supplier.organizationId, parsed.rows, parsed.missingFields);
    const missingFields = auto.missingFields;
    const issues = parsed.issues.filter((i) => !auto.resolvedKeys.has(`${i.row}:${i.field}`));
    const flaggedRows = new Set([
      ...missingFields.map((mf) => mf.row),
      ...issues.filter((i) => i.message.toLowerCase().includes("duplicate")).map((i) => i.row),
    ]).size;

    // Assigned inside the transaction; announced only after it commits.
    let alert = undefined as PendingVendorAlert | undefined;
    const upload = await this.prisma.$transaction(async (tx) => {
      const created = await tx.supplierUpload.create({
        data: {
          organizationId: supplier.organizationId,
          supplierUserId: supplier.id,
          originalName: input.fileName,
          mimeType: "text/csv",
          fileSize: input.content.length,
          fileContent: input.content,
          rowCount: auto.rows.length,
          status: SupplierUploadStatus.PENDING,
          submissionCount: 1,
          issues: issues as unknown as never,
          items: {
            create: auto.rows.map((r, idx) => {
              const missing = missingFields.find((mf) => mf.row === idx + 2);
              return {
                poNumber: r.poNumber,
                vendorId: r.vendorId,
                vendorName: r.vendorName,
                sku: r.sku,
                itemDescription: r.itemDescription,
                category: r.category,
                orderQty: r.orderQty,
                unitPriceBdt: r.unitPriceBdt,
                totalAmountBdt: r.totalAmountBdt,
                orderDate: r.orderDate,
                deliveryDate: r.deliveryDate,
                status: r.status,
                missingFields: missing?.fields ?? [],
              };
            }),
          },
        },
        include: { items: true },
      });

      const autoNote =
        auto.autoFixed > 0
          ? ` ${auto.autoFixed} missing value(s) were auto-filled from the file data or product catalog.`
          : "";
      const flagNote =
        flaggedRows > 0
          ? ` ${flaggedRows} row(s) have empty or duplicate values; the vendor may send them back for correction.`
          : "";
      await tx.supplierNotification.create({
        data: {
          organizationId: supplier.organizationId,
          supplierUserId: supplier.id,
          uploadId: created.id,
          type: "UPLOAD_RECEIVED",
          message: `Your file "${input.fileName}" was sent to the vendor for review.${autoNote}${flagNote}`,
        },
      });
      alert = await this.vendorNotifications.createForUpload(tx, {
        organizationId: supplier.organizationId,
        uploadId: created.id,
        type: "UPLOAD_SUBMITTED",
        message: `${supplier.name} submitted "${input.fileName}" (${auto.rows.length} row(s)) for review.`,
      });
      return created;
    });

    this.notifyChanged(supplier);
    this.vendorNotifications.announce(alert);
    return { ...upload, issues, missingFields };
  }

  /** Resubmission after a rejection: replaces the rows, resets to PENDING. */
  async resubmit(supplier: SupplierAuthUser, id: string, input: SupplierUploadInput) {
    const upload = await this.assertMyRejectedUpload(supplier, id);
    const fileName = input.fileName?.trim() || upload.originalName;
    const parsed = parseShipmentCsv(fileName, input.content);
    if (parsed.rows.length === 0) {
      throw invalidOperation("The file contains no product rows");
    }

    const auto = await this.autoResolveMissing(supplier.organizationId, parsed.rows, parsed.missingFields);
    const missingFields = auto.missingFields;
    const issues = parsed.issues.filter((i) => !auto.resolvedKeys.has(`${i.row}:${i.field}`));

    let alert = undefined as PendingVendorAlert | undefined;
    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.supplierUploadItem.deleteMany({ where: { uploadId: upload.id } });
      await tx.supplierUploadItem.createMany({
        data: auto.rows.map((r, idx) => {
          const missing = missingFields.find((mf) => mf.row === idx + 2);
          return {
            uploadId: upload.id,
            poNumber: r.poNumber,
            vendorId: r.vendorId,
            vendorName: r.vendorName,
            sku: r.sku,
            itemDescription: r.itemDescription,
            category: r.category,
            orderQty: r.orderQty,
            unitPriceBdt: r.unitPriceBdt,
            totalAmountBdt: r.totalAmountBdt,
            orderDate: r.orderDate,
            deliveryDate: r.deliveryDate,
            status: r.status,
            missingFields: missing?.fields ?? [],
          };
        }),
      });
      const result = await tx.supplierUpload.update({
        where: { id: upload.id },
        data: {
          status: SupplierUploadStatus.PENDING,
          submissionCount: { increment: 1 },
          originalName: fileName,
          fileContent: input.content,
          fileSize: input.content.length,
          rowCount: auto.rows.length,
          issues: issues as unknown as never,
          rejectedAt: null,
        },
      });
      await tx.supplierNotification.updateMany({
        where: { uploadId: upload.id, readAt: null },
        data: { readAt: new Date(), resolvedAt: new Date() },
      });
      alert = await this.vendorNotifications.createForUpload(tx, {
        organizationId: supplier.organizationId,
        uploadId: upload.id,
        type: "UPLOAD_RESUBMITTED",
        message: `${supplier.name} resubmitted "${fileName}" (${auto.rows.length} row(s)) after it was rejected.`,
      });

      return result;
    });

    this.notifyChanged(supplier);
    this.vendorNotifications.announce(alert);
    return { ...updated, issues, missingFields };
  }

  /** Supplier edits the flagged rows inline and submits the corrected data. */
  async resubmitWithEdits(supplier: SupplierAuthUser, id: string, input: ResubmitWithEditsInput) {
    const upload = await this.assertMyRejectedUpload(supplier, id);
    const issues: RowIssue[] = [];

    const rows = input.items.map((item, idx) => ({
      poNumber: item.poNumber ?? "",
      vendorId: item.vendorId ?? "",
      vendorName: item.vendorName ?? "",
      sku: item.sku ?? "",
      itemDescription: item.itemDescription ?? "",
      category: item.category ?? "",
      orderQty: item.orderQty ?? 0,
      unitPriceBdt: item.unitPriceBdt ?? 0,
      totalAmountBdt: item.totalAmountBdt ?? 0,
      orderDate: item.orderDate ?? "",
      deliveryDate: item.deliveryDate ?? "",
      status: item.status ?? "",
    }));

    rows.forEach((r, idx) => {
      const line = idx + 1;
      if (!r.poNumber) issues.push({ row: line, field: "po_number", message: "po_number is missing" });
      if (!r.sku) issues.push({ row: line, field: "sku", message: "sku is missing" });
      if (!r.itemDescription) issues.push({ row: line, field: "item_description", message: "item_description is missing" });
      if (r.orderQty <= 0) issues.push({ row: line, field: "order_qty", message: "order_qty must be a non-negative number" });
    });

    let alert = undefined as PendingVendorAlert | undefined;
    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.supplierUploadItem.deleteMany({ where: { uploadId: upload.id } });
      await tx.supplierUploadItem.createMany({
        data: rows.map((r) => ({ uploadId: upload.id, ...r })),
      });
      const result = await tx.supplierUpload.update({
        where: { id: upload.id },
        data: {
          status: SupplierUploadStatus.PENDING,
          submissionCount: { increment: 1 },
          rowCount: rows.length,
          issues: issues as unknown as never,
          rejectedAt: null,
        },
      });
      await tx.supplierNotification.updateMany({
        where: { uploadId: upload.id, readAt: null },
        data: { readAt: new Date(), resolvedAt: new Date() },
      });
      alert = await this.vendorNotifications.createForUpload(tx, {
        organizationId: supplier.organizationId,
        uploadId: upload.id,
        type: "UPLOAD_RESUBMITTED",
        message: `${supplier.name} resubmitted "${upload.originalName}" (${rows.length} row(s)) with corrections.`,
      });
      return result;
    });

    this.notifyChanged(supplier);
    this.vendorNotifications.announce(alert);
    return { ...updated, issues };
  }

  /** Every row waiting for this supplier's correction, across all uploads. */
  async listIncompleteItems(supplier: SupplierAuthUser) {
    return this.prisma.supplierUploadItem.findMany({
      where: awaitingSupplierWhere(supplier.id),
      include: {
        upload: {
          select: { id: true, originalName: true, vendorNote: true, status: true, createdAt: true },
        },
      },
      orderBy: [{ upload: { createdAt: "asc" } }, { id: "asc" }],
    });
  }

  /**
   * Supplier corrects returned rows. All-or-nothing: every row must be waiting
   * for this supplier's correction and have no empty columns. Accepted rows go
   * back to NEW in their original upload for the vendor to run ETL again; a
   * rejected upload is reopened for vendor review.
   */
  async resubmitIncompleteItems(supplier: SupplierAuthUser, input: ResubmitIncompleteItemsInput) {
    const stale = "Some rows are no longer waiting for your correction. Refresh the page and try again.";
    const ids = input.items.map((i) => i.id);
    const where = { id: { in: ids }, ...awaitingSupplierWhere(supplier.id) };
    const owned = await this.prisma.supplierUploadItem.findMany({
      where,
      select: { id: true, uploadId: true },
    });
    if (owned.length !== ids.length) throw invalidOperation(stale);

    const failures = input.items
      .map((item) => ({ id: item.id, fields: findEmptyColumns(item) }))
      .filter((f) => f.fields.length > 0);
    if (failures.length > 0) {
      throw new DomainException(
        ErrorCodes.VALIDATION_ERROR,
        `${failures.length} row(s) still have empty values`,
        400,
        { rows: failures },
      );
    }

    // Sorted so concurrent resubmits lock uploads in the same order.
    const uploadIds = [...new Set(owned.map((o) => o.uploadId))].sort();
    const alerts: PendingVendorAlert[] = [];
    await this.prisma.$transaction(async (tx) => {
      for (const uploadId of uploadIds) {
        await lockUpload(tx, uploadId, [...LIVE_UPLOAD_STATUSES, SupplierUploadStatus.REJECTED], stale);
      }
      // Re-check under the locks: the rows must still be waiting for us.
      if ((await tx.supplierUploadItem.count({ where })) !== ids.length) throw invalidOperation(stale);
      for (const { id, ...fields } of input.items) {
        await tx.supplierUploadItem.update({
          where: { id },
          data: { ...fields, etlStatus: SupplierItemEtlStatus.NEW, missingFields: [] },
        });
      }
      for (const uploadId of uploadIds) {
        const upload = await tx.supplierUpload.update({
          where: { id: uploadId },
          data: { submissionCount: { increment: 1 } },
          select: { originalName: true, status: true },
        });
        if (upload.status === SupplierUploadStatus.REJECTED) {
          // Reopen the file. Flagged rows not corrected in this batch are kept
          // for the supplier; the vendor reviews the rest again.
          await tx.supplierUploadItem.updateMany({
            where: { uploadId, etlStatus: SupplierItemEtlStatus.INCOMPLETE },
            data: { etlStatus: SupplierItemEtlStatus.RETURNED },
          });
          await tx.supplierUpload.update({
            where: { id: uploadId },
            data: { status: SupplierUploadStatus.PENDING, rejectedAt: null },
          });
        }
        await syncUploadStatus(tx, uploadId);
        await tx.supplierNotification.updateMany({
          where: { uploadId, readAt: null },
          data: { readAt: new Date(), resolvedAt: new Date() },
        });
        const count = owned.filter((o) => o.uploadId === uploadId).length;
        await tx.supplierNotification.create({
          data: {
            organizationId: supplier.organizationId,
            supplierUserId: supplier.id,
            uploadId,
            type: "UPLOAD_RECEIVED",
            message: `${count} corrected row(s) from "${upload.originalName}" were sent back to the vendor for review.`,
          },
        });
        alerts.push(
          await this.vendorNotifications.createForUpload(tx, {
            organizationId: supplier.organizationId,
            uploadId,
            type: "ROWS_RESUBMITTED",
            message: `${supplier.name} sent ${count} corrected row(s) from "${upload.originalName}" for review.`,
          }),
        );
      }
    });

    this.notifyChanged(supplier);
    alerts.forEach((a) => this.vendorNotifications.announce(a));
    return { resubmitted: input.items.length, uploads: uploadIds.length };
  }

  async file(supplier: SupplierAuthUser, id: string) {
    const upload = await this.prisma.supplierUpload.findFirst({
      where: { id, supplierUserId: supplier.id },
      select: { id: true, originalName: true, fileContent: true, mimeType: true },
    });
    if (!upload) throw notFound("Supplier upload", id);
    return upload;
  }

  // ---------------------------------------------------------------------------
  // Notifications
  // ---------------------------------------------------------------------------

  async listNotifications(supplier: SupplierAuthUser) {
    const where = { supplierUserId: supplier.id };
    const [data, unread] = await Promise.all([
      this.prisma.supplierNotification.findMany({
        where,
        include: {
          upload: {
            select: { id: true, originalName: true, status: true, vendorNote: true },
          },
        },
        orderBy: { createdAt: "desc" },
        take: 100,
      }),
      this.prisma.supplierNotification.count({ where: { ...where, readAt: null } }),
    ]);
    return { data, unread };
  }

  async markNotificationRead(supplier: SupplierAuthUser, id: string) {
    const notification = await this.prisma.supplierNotification.findFirst({
      where: { id, supplierUserId: supplier.id },
    });
    if (!notification) throw notFound("Notification", id);
    const updated = await this.prisma.supplierNotification.update({
      where: { id },
      data: { readAt: new Date() },
    });
    this.notifyChanged(supplier);
    return updated;
  }

  private async assertMyRejectedUpload(supplier: SupplierAuthUser, id: string) {
    const upload = await this.prisma.supplierUpload.findFirst({
      where: { id, supplierUserId: supplier.id },
    });
    if (!upload) throw notFound("Supplier upload", id);
    if (upload.status !== "REJECTED") {
      throw invalidOperation("Only rejected uploads can be resubmitted");
    }
    return upload;
  }

  /**
   * Automatically resolves missing fields where the value can be derived from
   * other fields in the same row or looked up from the vendor's product
   * catalog. Fields that cannot be resolved this way are left flagged so the
   * supplier is only asked to fill in genuinely unresolvable gaps.
   */
  private async autoResolveMissing(
    organizationId: string,
    rows: ParsedShipmentRow[],
    missingFields: Array<{ row: number; fields: string[] }>,
  ) {
    if (missingFields.length === 0) {
      return { rows, missingFields, autoFixed: 0, resolvedKeys: new Set<string>() };
    }

    const skus = [
      ...new Set(
        rows.filter((r) => r.sku.trim().length > 0).map((r) => r.sku.trim()),
      ),
    ];
    const products = skus.length
      ? await this.prisma.product.findMany({
          where: { organizationId, sku: { in: skus } },
          select: { sku: true, name: true },
        })
      : [];
    const productNameBySku = new Map(products.map((p) => [p.sku, p.name]));

    const resolvedKeys = new Set<string>();
    const remaining: Array<{ row: number; fields: string[] }> = [];
    let autoFixed = 0;
    const toLine = (index: number) => index + 2;

    rows.forEach((row, idx) => {
      const line = toLine(idx);
      const flags = missingFields.find((m) => m.row === line);
      if (!flags) return;

      const missing = [...flags.fields];
      const missingSet = new Set(missing);

      const hasQty = !missingSet.has("order_qty") && row.orderQty >= 0;
      const hasPrice = !missingSet.has("unit_price_bdt") && row.unitPriceBdt >= 0;
      const hasTotal = !missingSet.has("total_amount_bdt") && row.totalAmountBdt >= 0;

      const resolved: string[] = [];
      for (const field of missing) {
        if (field === "total_amount_bdt" && hasQty && hasPrice) {
          row.totalAmountBdt = Math.round(row.orderQty * row.unitPriceBdt * 100) / 100;
          resolved.push(field);
        } else if (field === "unit_price_bdt" && hasQty && hasTotal && row.orderQty > 0) {
          row.unitPriceBdt = Math.round((row.totalAmountBdt / row.orderQty) * 100) / 100;
          resolved.push(field);
        } else if (field === "order_qty" && hasPrice && hasTotal && row.unitPriceBdt > 0) {
          const qty = row.totalAmountBdt / row.unitPriceBdt;
          if (Number.isInteger(qty) && qty >= 0) {
            row.orderQty = qty;
            resolved.push(field);
          }
        } else if (field === "item_description" && row.sku.trim().length > 0) {
          const name = productNameBySku.get(row.sku.trim());
          if (name) {
            row.itemDescription = name;
            resolved.push(field);
          }
        }
      }

      for (const field of resolved) {
        resolvedKeys.add(`${line}:${field}`);
        autoFixed++;
      }

      const stillMissing = missing.filter((f) => !resolved.includes(f));
      if (stillMissing.length > 0) {
        remaining.push({ row: line, fields: stillMissing });
      }
    });

    return { rows, missingFields: remaining, autoFixed, resolvedKeys };
  }
}