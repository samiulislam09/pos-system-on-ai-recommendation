import { Injectable } from "@nestjs/common";
import { Prisma, MovementType } from "@inv/database";
import { insufficientAvailableStock, insufficientStock } from "../common/errors";

export interface ApplyMovementParams {
  db: Prisma.TransactionClient;
  organizationId: string;
  productId: string;
  locationId: string;
  type: MovementType;
  /** signed integer delta applied to the balance (e.g. -5 for a sale) */
  quantity: number;
  referenceType: string;
  referenceId: string;
  metadata?: Prisma.InputJsonValue;
  createdById?: string | null;
  /** when true, negative balances are permitted (e.g. STOCK_COUNT corrections) */
  allowNegative?: boolean;
}

export interface AppliedMovement {
  balance: number;
  movementId: string;
}

/**
 * Ledger-based inventory engine.
 *
 * Every balance-changing operation MUST pass through here so that each
 * change is recorded as an InventoryMovement ledger entry inside the same
 * database transaction as the business document (sale, purchase, transfer...).
 *
 * Concurrency: the Inventory row is locked with `SELECT ... FOR UPDATE` so two
 * simultaneous sales against the same (productId, locationId) serialize and
 * can never drive the balance below zero (unless allowNegative is set).
 */
@Injectable()
export class InventoryEngine {
  async applyMovement(params: ApplyMovementParams): Promise<AppliedMovement> {
    const {
      db,
      organizationId,
      productId,
      locationId,
      type,
      quantity,
      referenceType,
      referenceId,
      metadata,
      createdById,
      allowNegative = false,
    } = params;

    const locked = await db.$queryRaw<{ id: string }[]>`
      SELECT id FROM "Inventory"
      WHERE "productId" = ${productId} AND "locationId" = ${locationId}
      FOR UPDATE
    `;

    let inventory: { id: string; quantity: number; reservedQuantity: number } | null = null;

    if (locked.length > 0) {
      inventory = await db.inventory.findUnique({ where: { id: locked[0].id } });
    } else {
      try {
        inventory = await db.inventory.create({
          data: {
            organizationId,
            productId,
            locationId,
            quantity: 0,
            reservedQuantity: 0,
          },
        });
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
          const again = await db.$queryRaw<{ id: string }[]>`
            SELECT id FROM "Inventory"
            WHERE "productId" = ${productId} AND "locationId" = ${locationId}
            FOR UPDATE
          `;
          if (again.length === 0) throw e;
          inventory = await db.inventory.findUnique({ where: { id: again[0].id } });
        } else {
          throw e;
        }
      }
    }

    if (!inventory) {
      throw new Error("Unable to obtain inventory row");
    }

    const newQuantity = inventory.quantity + quantity;
    if (type === "SALE" && quantity < 0 && newQuantity < inventory.reservedQuantity) {
      throw insufficientAvailableStock(productId);
    }
    if (newQuantity < 0 && !allowNegative) {
      throw insufficientStock(productId);
    }

    await db.inventory.update({
      where: { id: inventory.id },
      data: { quantity: newQuantity },
    });

    const movement = await db.inventoryMovement.create({
      data: {
        organizationId,
        productId,
        locationId,
        type,
        quantity,
        referenceType,
        referenceId,
        metadata,
        createdById: createdById ?? null,
      },
    });

    return { balance: newQuantity, movementId: movement.id };
  }
}
