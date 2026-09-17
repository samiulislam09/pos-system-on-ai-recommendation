import { Injectable } from "@nestjs/common";
import { SupplierUploadStatus } from "@inv/database";
import { PrismaService } from "../prisma/prisma.service";
import { invalidOperation, notFound } from "../common/errors";
import { parseShipmentCsv, type ParsedShipmentRow, type RowIssue } from "./csv";
import type {
  FixSupplierUploadInput,
  ResubmitWithEditsInput,
  SupplierUploadInput,
} from "@inv/validation";
import type { SupplierAuthUser } from "./supplier-auth.decorator";

@Injectable()
export class SupplierUploadsService {
  constructor(private readonly prisma: PrismaService) {}

  async profile(supplier: SupplierAuthUser) {
    const [uploads, unread] = await Promise.all([
      this.prisma.supplierUpload.count({ where: { supplierUserId: supplier.id } }),
      this.prisma.supplierNotification.count({ where: { supplierUserId: supplier.id, readAt: null } }),
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
        items: { orderBy: { id: "asc" } },
        notifications: { orderBy: { createdAt: "desc" } },
      },
    });
    if (!upload) throw notFound("Supplier upload", id);
    return upload;
  }

  /**
   * Supplier uploads a product CSV. It is parsed and validated up front so the
   * supplier immediately sees which rows/columns are incomplete, then the
   * shipment is queued as PENDING for the vendor's review.
   */
  async createUpload(supplier: SupplierAuthUser, input: SupplierUploadInput) {
    const parsed = parseShipmentCsv(input.fileName, input.content);
    if (parsed.rows.length === 0) {
      throw invalidOperation("The file contains no product rows");
    }

    const auto = await this.autoResolveMissing(supplier.organizationId, parsed.rows, parsed.missingFields);
    const missingFields = auto.missingFields;
    const issues = parsed.issues.filter((i) => !auto.resolvedKeys.has(`${i.row}:${i.field}`));
    const duplicateIssues = issues.filter((i) => i.message.toLowerCase().includes("duplicate"));
    const hasMissing = missingFields.length > 0;
    const hasDuplicates = duplicateIssues.length > 0;
    const uploadStatus = (hasMissing || hasDuplicates)
      ? SupplierUploadStatus.INCOMPLETE
      : SupplierUploadStatus.PENDING;

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
          status: uploadStatus,
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

      if (hasMissing || hasDuplicates) {
        const totalMissing = missingFields.reduce((sum, mf) => sum + mf.fields.length, 0);
        const affectedRows = missingFields.length;
        const autoNote =
          auto.autoFixed > 0
            ? ` (${auto.autoFixed} missing value(s) were auto-filled from the file data or product catalog)`
            : "";
        
        let issueMsg = `Your file "${input.fileName}" requires correction before vendor review:`;
        if (hasMissing && hasDuplicates) {
          issueMsg += ` ${totalMissing} missing field(s) across ${affectedRows} row(s) and ${duplicateIssues.length} duplicate SKU row(s) were detected.${autoNote}`;
        } else if (hasMissing) {
          issueMsg += ` ${totalMissing} missing value(s) across ${affectedRows} row(s) could not be auto-filled.${autoNote}`;
        } else {
          issueMsg += ` ${duplicateIssues.length} duplicate SKU row(s) were detected.`;
        }
        
        await tx.supplierNotification.create({
          data: {
            organizationId: supplier.organizationId,
            supplierUserId: supplier.id,
            uploadId: created.id,
            type: "UPLOAD_RECEIVED",
            message: `${issueMsg} Please correct the flagged items so the vendor can review.`,
          },
        });
      } else {
        const autoNote =
          auto.autoFixed > 0
            ? ` ${auto.autoFixed} missing value(s) were auto-filled from the file data or product catalog.`
            : "";
        await tx.supplierNotification.create({
          data: {
            organizationId: supplier.organizationId,
            supplierUserId: supplier.id,
            uploadId: created.id,
            type: "UPLOAD_RECEIVED",
            message: `Your file "${input.fileName}" was uploaded and sent to the vendor for review.${autoNote}`,
          },
        });
      }
      return created;
    });

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
    const hasMissing = missingFields.length > 0;
    const uploadStatus = hasMissing
      ? SupplierUploadStatus.INCOMPLETE
      : SupplierUploadStatus.PENDING;

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
          status: uploadStatus,
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

      if (hasMissing) {
        const totalMissing = missingFields.reduce((sum, mf) => sum + mf.fields.length, 0);
        const affectedRows = missingFields.length;
        const autoNote =
          auto.autoFixed > 0
            ? ` (${auto.autoFixed} missing value(s) were auto-filled from the file data or product catalog)`
            : "";
        await tx.supplierNotification.create({
          data: {
            organizationId: supplier.organizationId,
            supplierUserId: supplier.id,
            uploadId: upload.id,
            type: "UPLOAD_RECEIVED",
            message: `Resubmitted file "${fileName}" still has ${totalMissing} missing value(s) across ${affectedRows} row(s) that could not be auto-filled. Please fill in the missing fields.${autoNote}`,
          },
        });
      }

      return result;
    });

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
      return result;
    });

    return { ...updated, issues };
  }

  /**
   * Supplier fixes missing fields on an INCOMPLETE upload.
   * Only the fields the supplier sends are updated; all other values are
   * preserved. Once every missing field is filled, the upload moves to
   * PENDING for the vendor's review.
   */
  async fixItems(supplier: SupplierAuthUser, id: string, input: FixSupplierUploadInput) {
    const upload = await this.prisma.supplierUpload.findFirst({
      where: { id, supplierUserId: supplier.id },
      include: { items: true },
    });
    if (!upload) throw notFound("Supplier upload", id);
    if (upload.status !== "INCOMPLETE") {
      throw invalidOperation("Only incomplete uploads can be fixed");
    }

    const owned = new Map(upload.items.map((i) => [i.id, i]));
    for (const item of input.items) {
      if (!item.id || !owned.has(item.id)) {
        throw invalidOperation("One or more items do not belong to this upload");
      }
    }

    const patches: Array<{ id: string; data: Record<string, unknown> }> = [];
    const stillMissing: string[] = [];

    for (const patch of input.items) {
      const current = owned.get(patch.id!)!;
      const missing = (current.missingFields as string[]) ?? [];

      const data: Record<string, unknown> = {};
      if (patch.poNumber !== undefined) data.poNumber = patch.poNumber;
      if (patch.vendorId !== undefined) data.vendorId = patch.vendorId;
      if (patch.vendorName !== undefined) data.vendorName = patch.vendorName;
      if (patch.sku !== undefined) data.sku = patch.sku;
      if (patch.itemDescription !== undefined) data.itemDescription = patch.itemDescription;
      if (patch.category !== undefined) data.category = patch.category;
      if (patch.orderQty !== undefined) data.orderQty = patch.orderQty;
      if (patch.unitPriceBdt !== undefined) data.unitPriceBdt = patch.unitPriceBdt;
      if (patch.totalAmountBdt !== undefined) data.totalAmountBdt = patch.totalAmountBdt;
      if (patch.orderDate !== undefined) data.orderDate = patch.orderDate;
      if (patch.deliveryDate !== undefined) data.deliveryDate = patch.deliveryDate;
      if (patch.status !== undefined) data.status = patch.status;

      const valueFor = (field: string): string | number | null => {
        switch (field) {
          case "po_number": return patch.poNumber ?? current.poNumber;
          case "sku": return patch.sku ?? current.sku;
          case "item_description": return patch.itemDescription ?? current.itemDescription;
          case "order_qty": return patch.orderQty ?? current.orderQty;
          case "unit_price_bdt": return patch.unitPriceBdt ?? Number(current.unitPriceBdt);
          case "total_amount_bdt": return patch.totalAmountBdt ?? Number(current.totalAmountBdt);
          default: return null;
        }
      };

      const remaining: string[] = [];
      for (const field of missing) {
        const value = valueFor(field);
        const ok =
          field === "order_qty" || field === "unit_price_bdt" || field === "total_amount_bdt"
            ? value !== null && value !== undefined && Number(value) >= 0
            : typeof value === "string" && value.trim().length > 0;
        if (!ok) remaining.push(field);
      }

      if (remaining.length > 0) {
        stillMissing.push(
          `"${current.sku || current.poNumber || "(row)"}" still needs: ${remaining.join(", ")}`,
        );
      }

      data.missingFields = remaining;
      patches.push({ id: patch.id!, data });
    }

    if (stillMissing.length > 0) {
      throw invalidOperation(
        `Please fill in all missing fields before submitting. ${stillMissing.join("; ")}`,
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      for (const p of patches) {
        await tx.supplierUploadItem.update({ where: { id: p.id }, data: p.data });
      }
      const result = await tx.supplierUpload.update({
        where: { id: upload.id },
        data: {
          status: SupplierUploadStatus.PENDING,
          submissionCount: { increment: 1 },
          issues: [],
          rejectedAt: null,
        },
      });

      await tx.supplierNotification.updateMany({
        where: { uploadId: upload.id, readAt: null },
        data: { readAt: new Date(), resolvedAt: new Date() },
      });

      await tx.supplierNotification.create({
        data: {
          organizationId: supplier.organizationId,
          supplierUserId: supplier.id,
          uploadId: upload.id,
          type: "UPLOAD_RECEIVED",
          message: `Missing fields for "${upload.originalName}" have been filled in. The file is now pending vendor review.`,
        },
      });

      return result;
    });

    return { ...updated, issues: [] };
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
    return this.prisma.supplierNotification.update({
      where: { id },
      data: { readAt: new Date() },
    });
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