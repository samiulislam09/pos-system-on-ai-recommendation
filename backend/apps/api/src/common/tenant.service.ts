import { Injectable } from "@nestjs/common";
import { Prisma } from "@inv/database";
import { PrismaService } from "../prisma/prisma.service";
import { tenantMismatch } from "./errors";

/**
 * Multi-tenant isolation helper. Every query against an organization-owned
 * resource must pass through here (or scope by organizationId directly).
 */
@Injectable()
export class TenantService {
  constructor(private readonly prisma: PrismaService) {}

  async assertLocation(
    organizationId: string,
    locationId: string,
    db: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    const location = await db.location.findUnique({ where: { id: locationId } });
    if (!location || location.organizationId !== organizationId) {
      throw tenantMismatch("Location");
    }
    return location;
  }

  async assertProduct(
    organizationId: string,
    productId: string,
    db: PrismaService | Prisma.TransactionClient = this.prisma,
  ) {
    const product = await db.product.findUnique({ where: { id: productId } });
    if (!product || product.organizationId !== organizationId) {
      throw tenantMismatch("Product");
    }
    return product;
  }

  async assertStore(
    organizationId: string,
    storeId: string,
    db: PrismaService | Prisma.TransactionClient = this.prisma,
  ) {
    const location = await this.assertLocation(organizationId, storeId, db);
    if (location.type !== "STORE" || location.status !== "ACTIVE") {
      throw tenantMismatch("Active store");
    }
    return location;
  }

  async assertTerminal(
    organizationId: string,
    terminalId: string,
    db: PrismaService | Prisma.TransactionClient = this.prisma,
  ) {
    const terminal = await db.postTerminal.findUnique({ where: { id: terminalId } });
    if (!terminal || terminal.organizationId !== organizationId || terminal.status !== "ACTIVE") {
      throw tenantMismatch("POS terminal");
    }
    return terminal;
  }

  async assertSupplier(
    organizationId: string,
    supplierId: string,
    db: PrismaService | Prisma.TransactionClient = this.prisma,
  ) {
    const supplier = await db.supplier.findUnique({ where: { id: supplierId } });
    if (!supplier || supplier.organizationId !== organizationId) {
      throw tenantMismatch("Supplier");
    }
    return supplier;
  }

  async assertPurchaseOrder(
    organizationId: string,
    purchaseOrderId: string,
    db: PrismaService | Prisma.TransactionClient = this.prisma,
  ) {
    const po = await db.purchaseOrder.findUnique({ where: { id: purchaseOrderId } });
    if (!po || po.organizationId !== organizationId) {
      throw tenantMismatch("Purchase order");
    }
    return po;
  }

  async assertSale(
    organizationId: string,
    saleId: string,
    db: PrismaService | Prisma.TransactionClient = this.prisma,
  ) {
    const sale = await db.sale.findUnique({ where: { id: saleId } });
    if (!sale || sale.organizationId !== organizationId) {
      throw tenantMismatch("Sale");
    }
    return sale;
  }

  async assertTransfer(
    organizationId: string,
    transferId: string,
    db: PrismaService | Prisma.TransactionClient = this.prisma,
  ) {
    const transfer = await db.stockTransfer.findUnique({ where: { id: transferId } });
    if (!transfer || transfer.organizationId !== organizationId) {
      throw tenantMismatch("Transfer");
    }
    return transfer;
  }
}
