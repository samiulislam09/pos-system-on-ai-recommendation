import { PrismaClient, EntityStatus, SaleStatus, PaymentStatus, PaymentMethod, PurchaseOrderStatus, TransferStatus, AdjustmentReason, MovementType } from "@prisma/client";
import { faker } from "@faker-js/faker";

const prisma = new PrismaClient();
const PREFIX = "TEMP";

// ---------------------------------------------------------------------------
// Static data
// ---------------------------------------------------------------------------

const CATEGORIES = [
  "Electronics", "Clothing", "Groceries", "Household", "Stationery",
  "Sports", "Beauty", "Toys", "Automotive", "Kitchen",
];

const BRANDS = [
  "AlphaTech", "UrbanStyle", "FreshHarvest", "HomePlus", "OfficePro",
];

const SUPPLIERS = [
  { name: "TechSource Ltd", contact: "Rahim Uddin", phone: "+8801711000001" },
  { name: "FashionHub BD", contact: "Karim Ahmed", phone: "+8801711000002" },
  { name: "GreenGrocers Inc", contact: "Fatima Begum", phone: "+8801711000003" },
  { name: "HomeNeeds Supply", contact: "Jamal Hossain", phone: "+8801711000004" },
  { name: "OfficeWorld", contact: "Nusrat Jahan", phone: "+8801711000005" },
  { name: "SportZone Trading", contact: "Arif Khan", phone: "+8801711000006" },
  { name: "BeautyLine Imports", contact: "Sumaiya Islam", phone: "+8801711000007" },
  { name: "ToyLand Wholesale", contact: "Bashir Miah", phone: "+8801711000008" },
  { name: "AutoParts BD", contact: "Kamal Hossain", phone: "+8801711000009" },
  { name: "KitchenKing Supply", contact: "Roksana Khatun", phone: "+8801711000010" },
];

const PRODUCT_TEMPLATES: Record<string, { names: string[]; units: string[]; costRange: [number, number]; sellMultiplier: number }> = {
  Electronics: {
    names: ["Wireless Mouse", "USB Keyboard", "Bluetooth Speaker", "Webcam HD", "Power Bank 10000mAh", "LED Desk Lamp", "Phone Charger Cable", "HDMI Cable 2m", "USB Hub 4-Port", "Laptop Stand"],
    units: ["pcs", "pcs", "pcs", "pcs", "pcs", "pcs", "pcs", "pcs", "pcs", "pcs"],
    costRange: [200, 3000],
    sellMultiplier: 1.4,
  },
  Clothing: {
    names: ["Cotton T-Shirt", "Denim Jeans", "Casual Shirt", "Formal Trousers", "Winter Jacket", "Sports Shorts", "Silk Scarf", "Leather Belt", "Wool Sweater", "Linen Pants"],
    units: ["pcs", "pcs", "pcs", "pcs", "pcs", "pcs", "pcs", "pcs", "pcs", "pcs"],
    costRange: [150, 2500],
    sellMultiplier: 1.8,
  },
  Groceries: {
    names: ["Basmati Rice 5kg", "Chicken Breast 1kg", "Fresh Eggs 12pk", "Cooking Oil 1L", "Sugar 1kg", "Onion 1kg", "Potato 2kg", "Milk 1L", "Bread Loaf", "Tea Bags 25pk"],
    units: ["pkt", "kg", "dozen", "pcs", "kg", "kg", "kg", "L", "pcs", "box"],
    costRange: [50, 800],
    sellMultiplier: 1.25,
  },
  Household: {
    names: ["Dish Soap 500ml", "Laundry Detergent 1kg", "Floor Cleaner 1L", "Trash Bags 30pk", "Sponge Pack 6pk", "Broom", "Mop Head", "Air Freshener", "Bleach 1L", "Paper Towels 6pk"],
    units: ["pcs", "pkt", "pcs", "pkt", "pkt", "pcs", "pcs", "pcs", "pcs", "pkt"],
    costRange: [80, 600],
    sellMultiplier: 1.5,
  },
  Stationery: {
    names: ["A4 Paper Ream", "Ballpoint Pen 10pk", "Notebook 200pg", "Stapler", "File Folder 10pk", "Highlighter Set", "Pencil 12pk", "Eraser Pack", "Scissors", "Tape Dispenser"],
    units: ["ream", "pkt", "pcs", "pcs", "pkt", "set", "pkt", "pkt", "pcs", "pcs"],
    costRange: [50, 500],
    sellMultiplier: 1.6,
  },
  Sports: {
    names: ["Cricket Bat", "Football Size 5", "Yoga Mat", "Skipping Rope", "Dumbbells 2kg Pair", "Water Bottle 1L", "Gym Bag", "Running Shoes", "Badminton Racket", "Resistance Band Set"],
    units: ["pcs", "pcs", "pcs", "pcs", "pair", "pcs", "pcs", "pair", "pcs", "set"],
    costRange: [200, 3000],
    sellMultiplier: 1.5,
  },
  Beauty: {
    names: ["Face Wash 100ml", "Moisturizer 50ml", "Shampoo 400ml", "Body Lotion 250ml", "Lip Balm", "Sunscreen SPF50", "Hair Oil 200ml", "Perfume 50ml", "Nail Polish Set", "Face Mask 10pk"],
    units: ["pcs", "pcs", "pcs", "pcs", "pcs", "pcs", "pcs", "pcs", "set", "pkt"],
    costRange: [100, 1500],
    sellMultiplier: 1.7,
  },
  Toys: {
    names: ["Building Blocks 100pk", "Puzzle 500pc", "RC Car", "Board Game", "Stuffed Bear", "Action Figure", "Play Dough Set", "Yo-Yo", "Card Game", "Toy Train Set"],
    units: ["pkt", "pcs", "pcs", "pcs", "pcs", "pcs", "set", "pcs", "pcs", "set"],
    costRange: [150, 2000],
    sellMultiplier: 1.6,
  },
  Automotive: {
    names: ["Car Air Freshener", "Engine Oil 4L", "Wiper Blades Pair", "Seat Cover Set", "Floor Mats", "Tire Pressure Gauge", "Car Charger", "Dash Cam", "Cleaning Cloth 5pk", "Battery Terminal Spray"],
    units: ["pcs", "pcs", "pair", "set", "set", "pcs", "pcs", "pcs", "pkt", "pcs"],
    costRange: [100, 3500],
    sellMultiplier: 1.4,
  },
  Kitchen: {
    names: ["Non-Stick Pan", "Knife Set 5pk", "Mixing Bowl Set", "Cutting Board", "Spatula Set", "Pressure Cooker 5L", "Blender 700W", "Coffee Mug Set", "Storage Containers 6pk", "Measuring Cup Set"],
    units: ["pcs", "set", "set", "pcs", "set", "pcs", "pcs", "set", "set", "set"],
    costRange: [200, 3000],
    sellMultiplier: 1.5,
  },
};

const SIZES = ["XS", "S", "M", "L", "XL", "XXL"];
const COLORS = ["Black", "White", "Red", "Blue", "Green", "Yellow", "Grey", "Navy", "Brown", "Pink"];
const UNITS = ["pcs", "kg", "L", "dozen", "pkt", "box", "set", "pair", "ream"];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function rand(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randChoice<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomDate(daysAgo: number): Date {
  const now = Date.now();
  const past = now - daysAgo * 24 * 60 * 60 * 1000;
  return new Date(past + Math.random() * (now - past));
}

function randomSku(index: number): string {
  return `${PREFIX}-SKU-${String(index).padStart(4, "0")}`;
}

function randomBarcode(): string {
  return faker.string.numeric(13);
}

// ---------------------------------------------------------------------------
// Clean
// ---------------------------------------------------------------------------

async function clean() {
  console.log(`\nCleaning all ${PREFIX}- prefixed data...\n`);

  // 1. Children first (FK-safe order)
  await prisma.saleReturnItem.deleteMany({ where: { product: { sku: { startsWith: PREFIX } } } });
  console.log("  ✓ SaleReturnItem");

  await prisma.stockAdjustmentItem.deleteMany({ where: { product: { sku: { startsWith: PREFIX } } } });
  console.log("  ✓ StockAdjustmentItem");

  await prisma.stockTransferItem.deleteMany({ where: { product: { sku: { startsWith: PREFIX } } } });
  console.log("  ✓ StockTransferItem");

  await prisma.payment.deleteMany({ where: { sale: { transactionNumber: { startsWith: PREFIX } } } });
  console.log("  ✓ Payment");

  await prisma.saleItem.deleteMany({ where: { sale: { transactionNumber: { startsWith: PREFIX } } } });
  console.log("  ✓ SaleItem");

  await prisma.saleReturn.deleteMany({ where: { returnNumber: { startsWith: PREFIX } } });
  console.log("  ✓ SaleReturn");

  await prisma.sale.deleteMany({ where: { transactionNumber: { startsWith: PREFIX } } });
  console.log("  ✓ Sale");

  await prisma.goodsReceiptItem.deleteMany({ where: { goodsReceipt: { receiptNumber: { startsWith: PREFIX } } } });
  console.log("  ✓ GoodsReceiptItem");

  await prisma.purchaseOrderItem.deleteMany({ where: { purchaseOrder: { poNumber: { startsWith: PREFIX } } } });
  console.log("  ✓ PurchaseOrderItem");

  await prisma.goodsReceipt.deleteMany({ where: { receiptNumber: { startsWith: PREFIX } } });
  console.log("  ✓ GoodsReceipt");

  await prisma.purchaseOrder.deleteMany({ where: { poNumber: { startsWith: PREFIX } } });
  console.log("  ✓ PurchaseOrder");

  await prisma.stockTransfer.deleteMany({ where: { transferNumber: { startsWith: PREFIX } } });
  console.log("  ✓ StockTransfer");

  await prisma.stockAdjustment.deleteMany({ where: { notes: { startsWith: PREFIX } } });
  console.log("  ✓ StockAdjustment");

  await prisma.inventoryMovement.deleteMany({ where: { product: { sku: { startsWith: PREFIX } } } });
  console.log("  ✓ InventoryMovement");

  await prisma.inventory.deleteMany({ where: { product: { sku: { startsWith: PREFIX } } } });
  console.log("  ✓ Inventory");

  await prisma.productVariant.deleteMany({ where: { sku: { startsWith: PREFIX } } });
  console.log("  ✓ ProductVariant");

  await prisma.product.deleteMany({ where: { sku: { startsWith: PREFIX } } });
  console.log("  ✓ Product");

  await prisma.supplier.deleteMany({ where: { name: { startsWith: PREFIX } } });
  console.log("  ✓ Supplier");

  await prisma.category.deleteMany({ where: { name: { startsWith: PREFIX } } });
  console.log("  ✓ Category");

  await prisma.brand.deleteMany({ where: { name: { startsWith: PREFIX } } });
  console.log("  ✓ Brand");

  await prisma.postTerminal.deleteMany({ where: { terminalCode: { startsWith: PREFIX } } });
  console.log("  ✓ PostTerminal");

  console.log(`\nCleanup complete. All ${PREFIX}- data removed.\n`);
}

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------

async function seed() {
  console.log(`\nSeeding ${PREFIX}- demo data...\n`);

  // Find existing org + admin + locations
  const org = await prisma.organization.findUnique({ where: { code: "DEMO" } });
  if (!org) {
    console.error("ERROR: Organization with code 'DEMO' not found. Run the base seed first: npm run db:seed");
    process.exit(1);
  }

  const admin = await prisma.user.findUnique({ where: { email: "admin@demo.com" } });
  if (!admin) {
    console.error("ERROR: Admin user not found. Run the base seed first: npm run db:seed");
    process.exit(1);
  }

  const stores = await prisma.location.findMany({
    where: { organizationId: org.id, type: "STORE" },
  });
  const warehouse = await prisma.location.findFirst({
    where: { organizationId: org.id, type: "WAREHOUSE" },
  });

  if (stores.length === 0 || !warehouse) {
    console.error("ERROR: Need at least 1 STORE and 1 WAREHOUSE location. Run the base seed first.");
    process.exit(1);
  }

  console.log(`  Org: ${org.code} | Admin: ${admin.email} | Stores: ${stores.length} | Warehouse: ${warehouse.code}`);

  // ── Categories ──────────────────────────────────────────────────────
  console.log("\n  Creating categories...");
  const categoryMap = new Map<string, string>();
  for (const name of CATEGORIES) {
    const cat = await prisma.category.upsert({
      where: { organizationId_name: { organizationId: org.id, name: `${PREFIX}-${name}` } },
      update: {},
      create: { organizationId: org.id, name: `${PREFIX}-${name}` },
    });
    categoryMap.set(name, cat.id);
  }
  console.log(`    ✓ ${CATEGORIES.length} categories`);

  // ── Brands ──────────────────────────────────────────────────────────
  console.log("  Creating brands...");
  const brandMap = new Map<string, string>();
  for (const name of BRANDS) {
    const brand = await prisma.brand.upsert({
      where: { organizationId_name: { organizationId: org.id, name: `${PREFIX}-${name}` } },
      update: {},
      create: { organizationId: org.id, name: `${PREFIX}-${name}` },
    });
    brandMap.set(name, brand.id);
  }
  console.log(`    ✓ ${BRANDS.length} brands`);

  // ── Suppliers ───────────────────────────────────────────────────────
  console.log("  Creating suppliers...");
  const supplierIds: string[] = [];
  for (const s of SUPPLIERS) {
    const supplier = await prisma.supplier.upsert({
      where: { organizationId_name: { organizationId: org.id, name: `${PREFIX}-${s.name}` } },
      update: {},
      create: {
        organizationId: org.id,
        name: `${PREFIX}-${s.name}`,
        contactName: s.contact,
        phone: s.phone,
        email: `${s.name.toLowerCase().replace(/\s+/g, "")}@example.com`,
        address: faker.location.streetAddress(),
      },
    });
    supplierIds.push(supplier.id);
  }
  console.log(`    ✓ ${SUPPLIERS.length} suppliers`);

  // ── Products + Variants ─────────────────────────────────────────────
  console.log("  Creating 100 products with variants...");
  const productIds: string[] = [];
  const allVariantIds: string[] = [];

  for (let i = 0; i < 100; i++) {
    const catName = CATEGORIES[i % CATEGORIES.length];
    const brandName = BRANDS[i % BRANDS.length];
    const template = PRODUCT_TEMPLATES[catName];
    const nameIdx = i % template.names.length;
    const cost = rand(template.costRange[0], template.costRange[1]);
    const sell = Math.round(cost * template.sellMultiplier);

    const product = await prisma.product.create({
      data: {
        organizationId: org.id,
        sku: randomSku(i),
        name: `${PREFIX} ${template.names[nameIdx]} ${String(i + 1).padStart(3, "0")}`,
        description: `Temporary demo product - ${template.names[nameIdx]}`,
        categoryId: categoryMap.get(catName)!,
        brandId: brandMap.get(brandName)!,
        unit: template.units[nameIdx],
        costPrice: cost,
        sellingPrice: sell,
        reorderLevel: rand(5, 20),
        status: EntityStatus.ACTIVE,
      },
    });
    productIds.push(product.id);

    // 1-3 variants
    const variantCount = rand(1, 3);
    for (let v = 0; v < variantCount; v++) {
      const variant = await prisma.productVariant.create({
        data: {
          organizationId: org.id,
          productId: product.id,
          sku: `${randomSku(i)}-V${v + 1}`,
          barcode: randomBarcode(),
          size: randChoice(SIZES),
          color: randChoice(COLORS),
        },
      });
      allVariantIds.push(variant.id);
    }
  }
  console.log(`    ✓ 100 products + ${allVariantIds.length} variants`);

  // ── Purchase Orders + Goods Receipts ────────────────────────────────
  console.log("  Creating purchase orders and goods receipts...");
  const poCount = 20;
  const poIds: string[] = [];

  for (let i = 0; i < poCount; i++) {
    const supplierId = randChoice(supplierIds);
    const productCount = rand(5, 10);
    const selectedProducts = faker.helpers.arrayElements(productIds, productCount);

    let totalAmount = 0;
    const itemsData = [];

    for (const prodId of selectedProducts) {
      const prod = await prisma.product.findUnique({ where: { id: prodId } });
      if (!prod) continue;
      const qty = rand(10, 100);
      const unitCost = Number(prod.costPrice);
      const total = unitCost * qty;
      totalAmount += total;
      itemsData.push({ productId: prodId, quantity: qty, receivedQuantity: qty, unitCost, total });
    }

    const po = await prisma.purchaseOrder.create({
      data: {
        organizationId: org.id,
        poNumber: `${PREFIX}-PO-${String(i + 1).padStart(4, "0")}`,
        supplierId,
        locationId: warehouse.id,
        status: PurchaseOrderStatus.RECEIVED,
        expectedAt: randomDate(45),
        totalAmount,
        notes: `${PREFIX} Demo purchase order`,
        createdById: admin.id,
        items: { create: itemsData },
      },
      include: { items: true },
    });
    poIds.push(po.id);

    // Goods receipt
    const receipt = await prisma.goodsReceipt.create({
      data: {
        organizationId: org.id,
        purchaseOrderId: po.id,
        locationId: warehouse.id,
        receiptNumber: `${PREFIX}-GR-${String(i + 1).padStart(4, "0")}`,
        receivedById: admin.id,
        notes: `${PREFIX} Goods received`,
        items: {
          create: po.items.map((poItem, idx) => ({
            purchaseOrderItemId: poItem.id,
            productId: itemsData[idx].productId,
            quantity: itemsData[idx].quantity,
            unitCost: itemsData[idx].unitCost,
            total: itemsData[idx].total,
          })),
        },
      },
    });

    // Inventory + movements for each item
    for (const item of itemsData) {
      await prisma.inventory.upsert({
        where: { productId_locationId: { productId: item.productId, locationId: warehouse.id } },
        update: { quantity: { increment: item.quantity } },
        create: {
          organizationId: org.id,
          productId: item.productId,
          locationId: warehouse.id,
          quantity: item.quantity,
        },
      });

      await prisma.inventoryMovement.create({
        data: {
          organizationId: org.id,
          productId: item.productId,
          locationId: warehouse.id,
          type: MovementType.PURCHASE,
          quantity: item.quantity,
          referenceType: "GoodsReceipt",
          referenceId: receipt.id,
          metadata: { poNumber: po.poNumber },
          createdById: admin.id,
        },
      });
    }
  }
  console.log(`    ✓ ${poCount} purchase orders + goods receipts + inventory`);

  // ── POS Terminal ────────────────────────────────────────────────────
  console.log("  Creating POS terminal...");
  const terminal = await prisma.postTerminal.upsert({
    where: { organizationId_terminalCode: { organizationId: org.id, terminalCode: `${PREFIX}-POS-01` } },
    update: {},
    create: {
      organizationId: org.id,
      storeId: stores[0].id,
      terminalCode: `${PREFIX}-POS-01`,
      status: EntityStatus.ACTIVE,
    },
  });
  console.log("    ✓ 1 POS terminal");

  // ── Sales ───────────────────────────────────────────────────────────
  console.log("  Creating 100 sales over past 30 days...");
  const saleCount = 100;

  for (let i = 0; i < saleCount; i++) {
    const store = randChoice(stores);
    const itemCount = rand(1, 5);
    const selectedProducts = faker.helpers.arrayElements(productIds, itemCount);

    let subtotal = 0;
    const saleItemsData = [];

    for (const prodId of selectedProducts) {
      const prod = await prisma.product.findUnique({ where: { id: prodId } });
      if (!prod) continue;
      const qty = rand(1, 5);
      const unitPrice = Number(prod.sellingPrice);
      const discount = Math.random() > 0.7 ? Math.round(unitPrice * qty * 0.1) : 0;
      const tax = Math.round((unitPrice * qty - discount) * 0.15);
      const total = unitPrice * qty - discount + tax;
      subtotal += unitPrice * qty;
      saleItemsData.push({ productId: prodId, quantity: qty, unitPrice, discount, tax, total });
    }

    const discount = Math.round(subtotal * (Math.random() > 0.7 ? 0.05 : 0));
    const tax = Math.round((subtotal - discount) * 0.15);
    const total = subtotal - discount + tax;
    const paymentMethod = randChoice([
      PaymentMethod.CASH, PaymentMethod.CARD, PaymentMethod.MOBILE_PAYMENT,
      PaymentMethod.CASH, PaymentMethod.CASH, PaymentMethod.CARD,
    ]);

    const sale = await prisma.sale.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        terminalId: terminal.id,
        transactionNumber: `${PREFIX}-TXN-${String(i + 1).padStart(5, "0")}`,
        status: SaleStatus.COMPLETED,
        subtotal,
        discount,
        tax,
        total,
        paymentStatus: PaymentStatus.PAID,
        createdById: admin.id,
        createdAt: randomDate(30),
        items: { create: saleItemsData },
        payments: {
          create: { method: paymentMethod, amount: total, status: PaymentStatus.PAID },
        },
      },
    });

    // Inventory deduction + movements
    for (const item of saleItemsData) {
      await prisma.inventory.upsert({
        where: { productId_locationId: { productId: item.productId, locationId: store.id } },
        update: { quantity: { decrement: item.quantity } },
        create: {
          organizationId: org.id,
          productId: item.productId,
          locationId: store.id,
          quantity: -item.quantity,
        },
      });

      await prisma.inventoryMovement.create({
        data: {
          organizationId: org.id,
          productId: item.productId,
          locationId: store.id,
          type: MovementType.SALE,
          quantity: -item.quantity,
          referenceType: "Sale",
          referenceId: sale.id,
          metadata: { transactionNumber: sale.transactionNumber },
          createdById: admin.id,
          createdAt: sale.createdAt,
        },
      });
    }
  }
  console.log(`    ✓ ${saleCount} sales + items + payments + inventory movements`);

  // ── Stock Transfers ─────────────────────────────────────────────────
  console.log("  Creating stock transfers...");
  const transferCount = 10;

  for (let i = 0; i < transferCount; i++) {
    const src = i % 2 === 0 ? warehouse : randChoice(stores);
    const dst = src.id === warehouse.id ? randChoice(stores) : warehouse;
    const productCount = rand(2, 5);
    const selectedProducts = faker.helpers.arrayElements(productIds, productCount);

    const itemsData = [];
    for (const prodId of selectedProducts) {
      const qty = rand(5, 30);
      itemsData.push({ productId: prodId, quantity: qty, receivedQuantity: qty });
    }

    const transfer = await prisma.stockTransfer.create({
      data: {
        organizationId: org.id,
        transferNumber: `${PREFIX}-TRF-${String(i + 1).padStart(4, "0")}`,
        sourceLocationId: src.id,
        destinationLocationId: dst.id,
        status: TransferStatus.RECEIVED,
        createdById: admin.id,
        receivedById: admin.id,
        notes: `${PREFIX} Demo stock transfer`,
        receivedAt: randomDate(15),
        items: { create: itemsData },
      },
    });

    // Inventory adjustments for transfers
    for (const item of itemsData) {
      // Source out
      await prisma.inventory.upsert({
        where: { productId_locationId: { productId: item.productId, locationId: src.id } },
        update: { quantity: { decrement: item.quantity } },
        create: { organizationId: org.id, productId: item.productId, locationId: src.id, quantity: -item.quantity },
      });
      await prisma.inventoryMovement.create({
        data: {
          organizationId: org.id, productId: item.productId, locationId: src.id,
          type: MovementType.TRANSFER_OUT, quantity: -item.quantity,
          referenceType: "StockTransfer", referenceId: transfer.id,
          createdById: admin.id, createdAt: transfer.receivedAt!,
        },
      });

      // Destination in
      await prisma.inventory.upsert({
        where: { productId_locationId: { productId: item.productId, locationId: dst.id } },
        update: { quantity: { increment: item.quantity } },
        create: { organizationId: org.id, productId: item.productId, locationId: dst.id, quantity: item.quantity },
      });
      await prisma.inventoryMovement.create({
        data: {
          organizationId: org.id, productId: item.productId, locationId: dst.id,
          type: MovementType.TRANSFER_IN, quantity: item.quantity,
          referenceType: "StockTransfer", referenceId: transfer.id,
          createdById: admin.id, createdAt: transfer.receivedAt!,
        },
      });
    }
  }
  console.log(`    ✓ ${transferCount} stock transfers + movements`);

  // ── Stock Adjustments ───────────────────────────────────────────────
  console.log("  Creating stock adjustments...");
  const adjustmentCount = 5;

  for (let i = 0; i < adjustmentCount; i++) {
    const store = randChoice([...stores, warehouse]);
    const productCount = rand(1, 3);
    const selectedProducts = faker.helpers.arrayElements(productIds, productCount);
    const reason = randChoice([
      AdjustmentReason.DAMAGED, AdjustmentReason.LOST, AdjustmentReason.STOCK_COUNT_VARIANCE,
    ]);

    const itemsData = selectedProducts.map((prodId) => ({
      productId: prodId,
      quantity: -rand(1, 5),
      reason,
    }));

    await prisma.stockAdjustment.create({
      data: {
        organizationId: org.id,
        locationId: store.id,
        reason,
        status: EntityStatus.ACTIVE,
        createdById: admin.id,
        notes: `${PREFIX} Demo adjustment - ${reason}`,
        createdAt: randomDate(20),
        items: { create: itemsData },
      },
    });
  }
  console.log(`    ✓ ${adjustmentCount} stock adjustments`);

  // ── Summary ─────────────────────────────────────────────────────────
  console.log(`\n${"=".repeat(50)}`);
  console.log(`  Seed complete!`);
  console.log(`  ${"=".repeat(50)}`);
  console.log(`  Categories:      ${CATEGORIES.length}`);
  console.log(`  Brands:          ${BRANDS.length}`);
  console.log(`  Suppliers:       ${SUPPLIERS.length}`);
  console.log(`  Products:        100`);
  console.log(`  Variants:        ${allVariantIds.length}`);
  console.log(`  Purchase Orders: ${poCount}`);
  console.log(`  Sales:           ${saleCount}`);
  console.log(`  Transfers:       ${transferCount}`);
  console.log(`  Adjustments:     ${adjustmentCount}`);
  console.log(`\n  All records have prefix: ${PREFIX}`);
  console.log(`  To clean up: npx tsx src/seed-demo.ts --clean\n`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const mode = args.includes("--seed") ? "seed" : args.includes("--clean") ? "clean" : null;

if (!mode) {
  console.log("Usage:");
  console.log("  npx tsx src/seed-demo.ts --seed   Insert demo data");
  console.log("  npx tsx src/seed-demo.ts --clean  Remove all demo data");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
}).finally(async () => {
  await prisma.$disconnect();
});

async function main() {
  if (mode === "seed") {
    await seed();
  } else {
    await clean();
  }
}
