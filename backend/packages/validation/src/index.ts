import { z } from "zod";

const cuid = z.string().min(1);
const sku = z.string().min(1).max(64);
const positiveInt = z.number().int().positive();
const nonNegativeInt = z.number().int().min(0);
const price = z.coerce.number().nonnegative().multipleOf(0.01);

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1),
});

export const registerOrganizationSchema = z.object({
  organizationName: z.string().min(1).max(120),
  organizationCode: z
    .string()
    .min(2)
    .max(20)
    .regex(/^[A-Z0-9-_]+$/, "code may only contain A-Z, 0-9, - and _"),
  name: z.string().min(1).max(120),
  email: z.string().email(),
  password: z.string().min(8).max(128),
});

// ---------------------------------------------------------------------------
// Users & roles
// ---------------------------------------------------------------------------

export const createUserSchema = z.object({
  name: z.string().min(1).max(120),
  email: z.string().email(),
  password: z.string().min(8).max(128),
  role: z.enum([
    "ORGANIZATION_ADMIN",
    "MANAGER",
    "STORE_MANAGER",
    "INVENTORY_MANAGER",
    "CASHIER",
    "VIEWER",
  ]),
});

export const updateUserSchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    role: z.enum([
      "ORGANIZATION_ADMIN",
      "MANAGER",
      "STORE_MANAGER",
      "INVENTORY_MANAGER",
      "CASHIER",
      "VIEWER",
    ]).optional(),
    status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
    password: z.string().min(8).max(128).optional(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Organizations
// ---------------------------------------------------------------------------

export const createOrganizationSchema = z.object({
  name: z.string().min(1).max(120),
  code: z
    .string()
    .min(2)
    .max(20)
    .regex(/^[A-Z0-9-_]+$/, "code may only contain A-Z, 0-9, - and _"),
  settings: z.record(z.unknown()).optional(),
});

export const updateOrganizationSchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    settings: z.record(z.unknown()).optional(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Locations / stores
// ---------------------------------------------------------------------------

export const createLocationSchema = z.object({
  name: z.string().min(1).max(120),
  code: z.string().min(1).max(32),
  type: z.enum(["STORE", "WAREHOUSE"]),
  address: z.string().max(255).optional(),
  settings: z.record(z.unknown()).optional(),
});

export const updateLocationSchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    address: z.string().max(255).optional(),
    status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
    settings: z.record(z.unknown()).optional(),
  })
  .strict();

export const createPostTerminalSchema = z.object({
  storeId: cuid,
  terminalCode: z.string().min(1).max(32),
});

export const updatePostTerminalSchema = z
  .object({
    status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

export const createCategorySchema = z.object({
  name: z.string().min(1).max(120),
  parentId: cuid.optional(),
});

export const createBrandSchema = z.object({
  name: z.string().min(1).max(120),
});

export const createProductSchema = z.object({
  sku,
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  categoryId: cuid.optional(),
  brandId: cuid.optional(),
  unit: z.string().max(20).default("pcs"),
  costPrice: price,
  sellingPrice: price,
  reorderLevel: nonNegativeInt.default(0),
  variants: z
    .array(
      z.object({
        sku,
        barcode: z.string().max(64).optional(),
        size: z.string().max(32).optional(),
        color: z.string().max(32).optional(),
      })
    )
    .optional(),
});

export const updateProductSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    description: z.string().max(1000).optional(),
    categoryId: cuid.optional().nullable(),
    brandId: cuid.optional().nullable(),
    unit: z.string().max(20).optional(),
    costPrice: price.optional(),
    sellingPrice: price.optional(),
    reorderLevel: nonNegativeInt.optional(),
    status: z.enum(["ACTIVE", "INACTIVE", "DISCONTINUED"]).optional(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Inventory
// ---------------------------------------------------------------------------

export const adjustInventorySchema = z.object({
  locationId: cuid,
  reason: z.enum([
    "DAMAGED",
    "LOST",
    "STOCK_COUNT_VARIANCE",
    "FOUND",
    "MANUAL_CORRECTION",
    "OTHER",
  ]),
  items: z
    .array(
      z.object({
        productId: cuid,
        quantity: z.number().int().refine((v) => v !== 0, {
          message: "quantity must be non-zero",
        }),
        reason: z
          .enum([
            "DAMAGED",
            "LOST",
            "STOCK_COUNT_VARIANCE",
            "FOUND",
            "MANUAL_CORRECTION",
            "OTHER",
          ])
          .optional(),
      })
    )
    .min(1),
  notes: z.string().max(500).optional(),
});

// ---------------------------------------------------------------------------
// Sales / events
// ---------------------------------------------------------------------------

export const saleItemSchema = z
  .object({
    sku,
    quantity: positiveInt,
  })
  .strict();

export const returnItemSchema = z.object({
  sku,
  quantity: positiveInt,
  unitPrice: price,
});

// The client only picks the method; the payment amount is always the
// server-computed sale total (amountTendered is informational, for change).
export const salePaymentSchema = z
  .object({
    method: z.enum(["CASH", "CARD", "MOBILE_PAYMENT"]),
    amountTendered: price.optional(),
  })
  .strict();

export const saleEventSchema = z
  .object({
    eventId: z.string().min(1).max(64),
    type: z.literal("SALE"),
    storeId: cuid,
    terminalId: cuid.optional(),
    timestamp: z.string().datetime(),
    items: z.array(saleItemSchema).min(1),
    payment: salePaymentSchema.optional(),
  })
  .strict();

export const returnEventSchema = z.object({
  eventId: z.string().min(1).max(64),
  type: z.literal("RETURN"),
  storeId: cuid,
  terminalId: cuid.optional(),
  timestamp: z.string().datetime(),
  saleId: cuid.optional(),
  reason: z.string().max(500).optional(),
  items: z.array(returnItemSchema).min(1),
});

export const posProductsQuerySchema = z.object({
  storeId: cuid,
  q: z.string().trim().max(120).default(""),
  limit: z.coerce.number().int().positive().max(50).default(25),
});

export const posEventSchema = z.discriminatedUnion("type", [
  saleEventSchema,
  returnEventSchema,
]);

export const eventBatchSchema = z.object({
  events: z.array(posEventSchema).min(1).max(500),
});

// ---------------------------------------------------------------------------
// Purchases
// ---------------------------------------------------------------------------

export const createSupplierSchema = z.object({
  name: z.string().min(1).max(120),
  contactName: z.string().max(120).optional(),
  phone: z.string().max(32).optional(),
  email: z.string().email().optional(),
  address: z.string().max(255).optional(),
});

export const createPurchaseOrderSchema = z.object({
  supplierId: cuid,
  locationId: cuid.optional(),
  expectedAt: z.string().datetime().optional(),
  notes: z.string().max(500).optional(),
  items: z
    .array(
      z.object({
        productId: cuid,
        quantity: positiveInt,
        unitCost: price,
      })
    )
    .min(1),
});

export const receivePurchaseOrderSchema = z.object({
  locationId: cuid,
  receivedById: cuid.optional(),
  notes: z.string().max(500).optional(),
  items: z
    .array(
      z.object({
        purchaseOrderItemId: cuid,
        productId: cuid,
        quantity: positiveInt,
      })
    )
    .min(1),
});

// ---------------------------------------------------------------------------
// Transfers
// ---------------------------------------------------------------------------

export const createTransferSchema = z.object({
  sourceLocationId: cuid,
  destinationLocationId: cuid,
  notes: z.string().max(500).optional(),
  items: z
    .array(
      z.object({
        productId: cuid,
        quantity: positiveInt,
      })
    )
    .min(1),
});

export const receiveTransferSchema = z.object({
  items: z
    .array(
      z.object({
        transferItemId: cuid,
        quantity: positiveInt,
      })
    )
    .min(1),
});

// ---------------------------------------------------------------------------
// Returns (admin approve)
// ---------------------------------------------------------------------------

export const approveReturnSchema = z.object({
  items: z
    .array(
      z.object({
        returnItemId: cuid,
        quantity: positiveInt,
      })
    )
    .min(1),
});

// ---------------------------------------------------------------------------
// Supplier portal
// ---------------------------------------------------------------------------

export const supplierLoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const createSupplierUserSchema = z.object({
  name: z.string().min(1).max(120),
  email: z.string().email(),
  password: z.string().min(8).max(128),
  phone: z.string().max(32).optional(),
  supplierId: cuid.optional(),
});

export const supplierUploadSchema = z.object({
  fileName: z.string().min(1).max(255),
  content: z.string().min(10),
});

export const supplierUploadItemSchema = z.object({
  poNumber: z.string().min(1),
  vendorId: z.string().default(""),
  vendorName: z.string().default(""),
  sku: z.string().min(1),
  itemDescription: z.string().min(1),
  category: z.string().default(""),
  orderQty: z.number().int().nonnegative().default(0),
  unitPriceBdt: z.coerce.number().nonnegative().multipleOf(0.01).default(0),
  totalAmountBdt: z.coerce.number().nonnegative().multipleOf(0.01).default(0),
  orderDate: z.string().default(""),
  deliveryDate: z.string().default(""),
  status: z.string().default(""),
});

export const supplierResubmitSchema = z.object({
  content: z.string().min(10),
});

export const supplierUploadItemUpdateSchema = z.object({
  id: cuid.optional(),
  poNumber: z.string().min(1).optional(),
  vendorId: z.string().optional(),
  vendorName: z.string().optional(),
  sku: z.string().min(1).optional(),
  itemDescription: z.string().min(1).optional(),
  category: z.string().optional(),
  orderQty: z.number().int().nonnegative().optional(),
  unitPriceBdt: z.coerce.number().nonnegative().multipleOf(0.01).optional(),
  totalAmountBdt: z.coerce.number().nonnegative().multipleOf(0.01).optional(),
  orderDate: z.string().optional(),
  deliveryDate: z.string().optional(),
  status: z.string().optional(),
});

export const resubmitWithEditsSchema = z.object({
  items: z.array(supplierUploadItemUpdateSchema).min(1),
});

export const fixSupplierUploadSchema = z.object({
  items: z.array(supplierUploadItemUpdateSchema).min(1),
});

export const acceptSupplierUploadSchema = z.object({
  locationId: cuid,
});

export const rejectSupplierUploadSchema = z.object({
  note: z.string().min(1).max(2000),
});

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

export const salesExportQuerySchema = z.object({
  storeId: cuid.optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

export const paginationSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(25),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterOrganizationInput = z.infer<typeof registerOrganizationSchema>;
export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;
export type UpdateOrganizationInput = z.infer<typeof updateOrganizationSchema>;
export type CreateLocationInput = z.infer<typeof createLocationSchema>;
export type UpdateLocationInput = z.infer<typeof updateLocationSchema>;
export type CreateSupplierInput = z.infer<typeof createSupplierSchema>;
export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
export type AdjustInventoryInput = z.infer<typeof adjustInventorySchema>;
export type SaleEventInput = z.infer<typeof saleEventSchema>;
export type ReturnEventInput = z.infer<typeof returnEventSchema>;
export type PosEventInput = z.infer<typeof posEventSchema>;
export type PosProductsQueryInput = z.infer<typeof posProductsQuerySchema>;
export type CreatePurchaseOrderInput = z.infer<typeof createPurchaseOrderSchema>;
export type ReceivePurchaseOrderInput = z.infer<typeof receivePurchaseOrderSchema>;
export type CreateTransferInput = z.infer<typeof createTransferSchema>;
export type ReceiveTransferInput = z.infer<typeof receiveTransferSchema>;
export type ApproveReturnInput = z.infer<typeof approveReturnSchema>;
export type SupplierLoginInput = z.infer<typeof supplierLoginSchema>;
export type CreateSupplierUserInput = z.infer<typeof createSupplierUserSchema>;
export type SupplierUploadInput = z.infer<typeof supplierUploadSchema>;
export type SupplierUploadItemUpdateInput = z.infer<typeof supplierUploadItemUpdateSchema>;
export type SupplierResubmitInput = z.infer<typeof supplierResubmitSchema>;
export type ResubmitWithEditsInput = z.infer<typeof resubmitWithEditsSchema>;
export type FixSupplierUploadInput = z.infer<typeof fixSupplierUploadSchema>;
export type AcceptSupplierUploadInput = z.infer<typeof acceptSupplierUploadSchema>;
export type RejectSupplierUploadInput = z.infer<typeof rejectSupplierUploadSchema>;
