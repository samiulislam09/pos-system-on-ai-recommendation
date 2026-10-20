/**
 * Analytics demo data: ~18 months of realistic POS sales so the dashboard,
 * reports and OLAP cube have something worth slicing.
 *
 *   npm run seed:analytics -w @inv/api                       seed (replaces previous run)
 *   npm run seed:analytics -w @inv/api -- --months 24 --daily 30
 *   npm run clean:analytics -w @inv/api                      remove everything it created
 *
 * Patterns baked in, so drill-downs show real structure rather than noise:
 *   - steady growth over the period, plus Fri/Sat (BD weekend) peaks
 *   - Eid shopping surges (clothing especially) and a Ramadan grocery lift
 *   - category seasons: summer beverages, winter clothing, January stationery
 *   - stores of different sizes and product mixes; Sylhet opens mid-period
 *   - mobile payments gaining share over time
 *
 * Everything created is tagged with the SIM- prefix (SKUs, location and terminal
 * codes, transaction and transfer numbers), and --clean removes exactly that.
 * Once the rows are in, the OLAP star schema is rebuilt with the API's own ETL.
 */
import { randomUUID } from "node:crypto";
import {
  prisma,
  EntityStatus,
  LocationType,
  MovementType,
  PaymentMethod,
  PaymentStatus,
  SaleStatus,
  TransferStatus,
  type Prisma,
} from "@inv/database";
import { ETL_STATEMENTS, STAR_SCHEMA_DDL } from "../src/olap/olap.cube";

const PREFIX = "SIM";
const DHAKA_UTC_OFFSET_H = 6;
const BATCH = 5000;

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(`--${name}`);
const option = (name: string, fallback: number) => {
  const i = argv.indexOf(`--${name}`);
  const n = i === -1 ? NaN : Number(argv[i + 1]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};
const orgCode = (() => {
  const i = argv.indexOf("--org");
  return i === -1 ? "DEMO" : argv[i + 1];
})();

const MONTHS = option("months", 18);
/** Average transactions per day for a store of size 1.0. */
const DAILY = option("daily", 22);

// ---------------------------------------------------------------------------
// Deterministic randomness (same data on every run)
// ---------------------------------------------------------------------------

let rngState = option("rng", 20261020) >>> 0;
function random(): number {
  rngState = (rngState + 0x6d2b79f5) >>> 0;
  let t = rngState;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const randInt = (min: number, max: number) => Math.floor(random() * (max - min + 1)) + min;
const chance = (p: number) => random() < p;
function weighted<T>(items: T[], weight: (item: T) => number): T {
  const weights = items.map(weight);
  let r = random() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}
/** Poisson-distributed count (Knuth for small means, normal approximation above). */
function poisson(mean: number): number {
  if (mean > 30) return Math.max(0, Math.round(mean + Math.sqrt(mean) * gaussian()));
  const limit = Math.exp(-mean);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= random();
  } while (p > limit);
  return k - 1;
}
function gaussian(): number {
  return Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random());
}
const money = (n: number) => Math.round(n * 100) / 100;

// ---------------------------------------------------------------------------
// Catalogue
// ---------------------------------------------------------------------------

type Category =
  | "Groceries"
  | "Beverages"
  | "Personal Care"
  | "Household"
  | "Clothing"
  | "Electronics"
  | "Stationery"
  | "Snacks";

/** Monthly demand multiplier per category, index 0 = January. */
const SEASON: Record<Category, number[]> = {
  Groceries: [1, 1, 1.05, 1.05, 1, 1, 1, 1, 1, 1, 1, 1.05],
  Beverages: [0.7, 0.8, 1.1, 1.5, 1.6, 1.45, 1.25, 1.2, 1.1, 0.95, 0.8, 0.7],
  "Personal Care": [1.1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1.05, 1.15],
  Household: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1.15, 1, 1],
  Clothing: [1.35, 0.9, 1, 1, 0.9, 0.85, 0.8, 0.85, 0.95, 1.1, 1.3, 1.55],
  Electronics: [0.95, 0.9, 0.95, 1, 1, 0.95, 0.95, 1, 1, 1.05, 1.4, 1.35],
  Stationery: [2.1, 1.4, 1, 0.85, 0.8, 0.9, 1.2, 0.9, 0.8, 0.8, 0.9, 1.1],
  Snacks: [1, 1, 1.05, 1.1, 1.1, 1.05, 1.05, 1.05, 1, 1, 1, 1.1],
};

const PRODUCTS: Array<{ category: Category; name: string; unit: string; cost: number; price: number }> = [
  { category: "Groceries", name: "Miniket Rice 5kg", unit: "pkt", cost: 360, price: 420 },
  { category: "Groceries", name: "Soybean Oil 2L", unit: "btl", cost: 330, price: 375 },
  { category: "Groceries", name: "Red Lentils 1kg", unit: "kg", cost: 115, price: 140 },
  { category: "Groceries", name: "Sugar 1kg", unit: "kg", cost: 120, price: 140 },
  { category: "Groceries", name: "Atta Flour 2kg", unit: "pkt", cost: 115, price: 135 },
  { category: "Groceries", name: "Iodized Salt 1kg", unit: "pkt", cost: 35, price: 45 },
  { category: "Groceries", name: "Farm Eggs 12pc", unit: "dozen", cost: 135, price: 160 },
  { category: "Groceries", name: "Chinigura Rice 1kg", unit: "pkt", cost: 140, price: 170 },
  { category: "Beverages", name: "Mineral Water 1.5L", unit: "btl", cost: 22, price: 30 },
  { category: "Beverages", name: "Mango Juice 1L", unit: "pack", cost: 85, price: 110 },
  { category: "Beverages", name: "Cola 1.25L", unit: "btl", cost: 65, price: 85 },
  { category: "Beverages", name: "Black Tea 400g", unit: "pkt", cost: 190, price: 240 },
  { category: "Beverages", name: "Instant Coffee 100g", unit: "jar", cost: 320, price: 410 },
  { category: "Beverages", name: "Liquid Milk 1L", unit: "pack", cost: 85, price: 100 },
  { category: "Beverages", name: "Energy Drink 250ml", unit: "can", cost: 40, price: 55 },
  { category: "Personal Care", name: "Herbal Shampoo 340ml", unit: "btl", cost: 260, price: 340 },
  { category: "Personal Care", name: "Beauty Soap 100g", unit: "pcs", cost: 48, price: 65 },
  { category: "Personal Care", name: "Toothpaste 200g", unit: "pcs", cost: 120, price: 160 },
  { category: "Personal Care", name: "Coconut Hair Oil 200ml", unit: "btl", cost: 110, price: 145 },
  { category: "Personal Care", name: "Face Wash 100ml", unit: "pcs", cost: 190, price: 260 },
  { category: "Personal Care", name: "Body Lotion 300ml", unit: "btl", cost: 280, price: 380 },
  { category: "Personal Care", name: "Hand Sanitizer 200ml", unit: "btl", cost: 70, price: 99 },
  { category: "Household", name: "Detergent Powder 1kg", unit: "pkt", cost: 150, price: 190 },
  { category: "Household", name: "Dishwashing Liquid 500ml", unit: "btl", cost: 95, price: 125 },
  { category: "Household", name: "Floor Cleaner 1L", unit: "btl", cost: 160, price: 210 },
  { category: "Household", name: "Toilet Tissue 4 roll", unit: "pack", cost: 110, price: 145 },
  { category: "Household", name: "Mosquito Coil 10pc", unit: "box", cost: 75, price: 100 },
  { category: "Household", name: "LED Bulb 12W", unit: "pcs", cost: 140, price: 210 },
  { category: "Clothing", name: "Cotton Panjabi", unit: "pcs", cost: 1100, price: 1850 },
  { category: "Clothing", name: "Printed Three-Piece", unit: "set", cost: 1500, price: 2600 },
  { category: "Clothing", name: "Men's Polo Shirt", unit: "pcs", cost: 450, price: 790 },
  { category: "Clothing", name: "Denim Jeans", unit: "pcs", cost: 850, price: 1450 },
  { category: "Clothing", name: "Winter Hoodie", unit: "pcs", cost: 900, price: 1590 },
  { category: "Clothing", name: "Kids T-Shirt", unit: "pcs", cost: 220, price: 390 },
  { category: "Clothing", name: "Cotton Lungi", unit: "pcs", cost: 300, price: 480 },
  { category: "Electronics", name: "Power Bank 10000mAh", unit: "pcs", cost: 1150, price: 1650 },
  { category: "Electronics", name: "Wireless Earbuds", unit: "pcs", cost: 1400, price: 2200 },
  { category: "Electronics", name: "USB-C Charger 25W", unit: "pcs", cost: 650, price: 990 },
  { category: "Electronics", name: "Bluetooth Speaker", unit: "pcs", cost: 1600, price: 2450 },
  { category: "Electronics", name: "Rechargeable Fan", unit: "pcs", cost: 2600, price: 3600 },
  { category: "Electronics", name: "Smart Watch", unit: "pcs", cost: 2200, price: 3400 },
  { category: "Stationery", name: "Exercise Book 120pg", unit: "pcs", cost: 45, price: 65 },
  { category: "Stationery", name: "Ballpoint Pen 10pc", unit: "box", cost: 70, price: 100 },
  { category: "Stationery", name: "Geometry Box", unit: "set", cost: 160, price: 240 },
  { category: "Stationery", name: "School Backpack", unit: "pcs", cost: 750, price: 1200 },
  { category: "Stationery", name: "A4 Paper Ream", unit: "ream", cost: 420, price: 520 },
  { category: "Stationery", name: "Colour Pencils 24pc", unit: "box", cost: 140, price: 210 },
  { category: "Snacks", name: "Potato Chips 50g", unit: "pkt", cost: 20, price: 30 },
  { category: "Snacks", name: "Butter Biscuits 300g", unit: "pkt", cost: 70, price: 95 },
  { category: "Snacks", name: "Instant Noodles 8pc", unit: "pack", cost: 150, price: 190 },
  { category: "Snacks", name: "Chocolate Bar 40g", unit: "pcs", cost: 55, price: 80 },
  { category: "Snacks", name: "Chanachur 350g", unit: "pkt", cost: 75, price: 100 },
  { category: "Snacks", name: "Dates 500g", unit: "box", cost: 260, price: 350 },
];

/** Dates (UTC) of Eid ul-Fitr and Eid ul-Adha; shopping surges in the run-up. */
const EIDS = ["2024-04-10", "2024-06-17", "2025-03-31", "2025-06-07", "2026-03-20", "2026-05-27", "2027-03-10", "2027-05-17"]
  .map((d) => Date.parse(`${d}T00:00:00Z`));
const EID_FITR = new Set([0, 2, 4, 6].map((i) => EIDS[i]));

type StoreProfile = {
  code: string;
  name: string;
  /** Existing base-seed store this profile describes, rather than a new SIM location. */
  existing?: boolean;
  size: number;
  /** Months before today the store opened (undefined = open the whole period). */
  openedMonthsAgo?: number;
  affinity: Partial<Record<Category, number>>;
};

const STORES: StoreProfile[] = [
  { code: "DHK-DHN", name: "Dhanmondi Store", existing: true, size: 1.0, affinity: { Clothing: 1.3, "Personal Care": 1.2 } },
  { code: "DHK-MIR", name: "Mirpur Store", existing: true, size: 0.85, affinity: { Groceries: 1.4, Snacks: 1.2, Electronics: 0.7 } },
  { code: `${PREFIX}-GUL`, name: "Gulshan Store", size: 1.3, affinity: { Electronics: 1.8, "Personal Care": 1.4, Groceries: 0.8 } },
  { code: `${PREFIX}-CTG`, name: "Chattogram Store", size: 0.95, affinity: { Groceries: 1.2, Household: 1.3, Clothing: 1.1 } },
  { code: `${PREFIX}-SYL`, name: "Sylhet Store", size: 0.6, openedMonthsAgo: 8, affinity: { Beverages: 1.4, Snacks: 1.3 } },
];

// ---------------------------------------------------------------------------
// Demand model
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;

function daysToNextEid(dayStart: number): number {
  const next = EIDS.find((e) => e >= dayStart);
  return next === undefined ? Infinity : (next - dayStart) / DAY_MS;
}

/** Store-wide traffic multiplier for a day. */
function trafficFactor(dayStart: number, progress: number): number {
  const weekday = new Date(dayStart).getUTCDay(); // 5 = Fri, 6 = Sat
  const weekdayFactor = weekday === 5 ? 1.35 : weekday === 6 ? 1.2 : weekday === 0 ? 0.92 : 1;
  const trend = 0.7 + 0.45 * progress;
  const toEid = daysToNextEid(dayStart);
  const eid = toEid === 0 ? 0.45 : toEid <= 10 ? 1.25 + (10 - toEid) * 0.05 : 1;
  return weekdayFactor * trend * eid * (0.9 + random() * 0.2);
}

function categoryFactor(category: Category, dayStart: number): number {
  const month = new Date(dayStart).getUTCMonth();
  let f = SEASON[category][month];
  const toEid = daysToNextEid(dayStart);
  if (toEid > 0 && toEid <= 12 && category === "Clothing") f *= 2.6;
  // The ~30 days before Eid ul-Fitr are Ramadan: groceries, dates and drinks lift.
  const fitr = EIDS.find((e) => e >= dayStart && EID_FITR.has(e));
  if (fitr !== undefined && (fitr - dayStart) / DAY_MS <= 30) {
    if (category === "Groceries" || category === "Beverages") f *= 1.3;
  }
  return f;
}

/** Local (Dhaka) opening hours 10:00–22:00, peaking at lunch and early evening. */
const HOUR_WEIGHTS = [0.4, 0.7, 1, 1.1, 0.9, 0.8, 0.9, 1.1, 1.4, 1.5, 1.2, 0.7];

// ---------------------------------------------------------------------------
// Clean
// ---------------------------------------------------------------------------

async function clean(orgId: string) {
  const like = { startsWith: `${PREFIX}-` };
  const sales = await prisma.sale.deleteMany({ where: { organizationId: orgId, transactionNumber: like } });
  const movements = await prisma.inventoryMovement.deleteMany({
    where: { organizationId: orgId, product: { sku: like } },
  });
  const transfers = await prisma.stockTransfer.deleteMany({ where: { organizationId: orgId, transferNumber: like } });
  await prisma.inventory.deleteMany({ where: { organizationId: orgId, product: { sku: like } } });
  const products = await prisma.product.deleteMany({ where: { organizationId: orgId, sku: like } });
  await prisma.postTerminal.deleteMany({ where: { organizationId: orgId, terminalCode: like } });
  const locations = await prisma.location.deleteMany({ where: { organizationId: orgId, code: like } });
  // Categories are shared by name, so only drop the ones left empty.
  const categories = await prisma.category.deleteMany({
    where: { organizationId: orgId, name: { in: Object.keys(SEASON) }, products: { none: {} } },
  });
  console.log(
    `  removed ${sales.count} sales, ${movements.count} movements, ${transfers.count} transfers, ` +
      `${products.count} products, ${locations.count} stores, ${categories.count} categories`,
  );
}

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------

async function seed(orgId: string, adminId: string | null) {
  // Transaction and transfer numbers are unique across organizations.
  const tag = `${PREFIX}-${orgCode}`;
  const now = Date.now();
  const todayStart = Math.floor(now / DAY_MS) * DAY_MS;
  const periodStart = todayStart - Math.round(MONTHS * 30.44) * DAY_MS;
  console.log(
    `  period ${new Date(periodStart).toISOString().slice(0, 10)} → today, ~${DAILY} transactions/day per store`,
  );

  // Locations ---------------------------------------------------------------
  const warehouse = await prisma.location.findFirst({
    where: { organizationId: orgId, type: LocationType.WAREHOUSE },
  });
  if (!warehouse) throw new Error("No WAREHOUSE location found. Run the base seed first: npm run db:seed");

  const stores: Array<StoreProfile & { id: string; terminalId: string; openedAt: number }> = [];
  for (const profile of STORES) {
    const location = profile.existing
      ? await prisma.location.findUnique({ where: { organizationId_code: { organizationId: orgId, code: profile.code } } })
      : await prisma.location.create({
          data: { organizationId: orgId, code: profile.code, name: profile.name, type: LocationType.STORE },
        });
    if (!location) {
      console.log(`  skipping ${profile.name}: location ${profile.code} not found`);
      continue;
    }
    const terminal = await prisma.postTerminal.create({
      data: { organizationId: orgId, storeId: location.id, terminalCode: `${PREFIX}-POS-${profile.code}` },
    });
    const openedAt =
      profile.openedMonthsAgo === undefined
        ? periodStart
        : todayStart - Math.round(profile.openedMonthsAgo * 30.44) * DAY_MS;
    stores.push({ ...profile, id: location.id, terminalId: terminal.id, openedAt });
  }
  console.log(`  ${stores.length} stores (${stores.filter((s) => !s.existing).length} new)`);

  // Categories + products ---------------------------------------------------
  const categoryIds = new Map<Category, string>();
  for (const name of Object.keys(SEASON) as Category[]) {
    const category = await prisma.category.upsert({
      where: { organizationId_name: { organizationId: orgId, name } },
      update: {},
      create: { organizationId: orgId, name },
    });
    categoryIds.set(name, category.id);
  }

  const products = PRODUCTS.map((p, i) => ({
    ...p,
    id: randomUUID(),
    sku: `${PREFIX}-${String(i + 1).padStart(4, "0")}`,
    // Zipf-ish popularity so every category has its best-sellers.
    popularity: 1 / Math.pow((i % 8) + 1, 0.6) * (0.7 + random() * 0.6),
    // Cheap staples sell in multiples; big-ticket items one at a time.
    maxQty: p.price < 150 ? 4 : p.price < 600 ? 2 : 1,
    soldPerStore: new Map<string, number>(),
  }));
  await prisma.product.createMany({
    data: products.map((p) => ({
      id: p.id,
      organizationId: orgId,
      sku: p.sku,
      name: p.name,
      categoryId: categoryIds.get(p.category)!,
      unit: p.unit,
      costPrice: p.cost,
      sellingPrice: p.price,
      status: EntityStatus.ACTIVE,
    })),
  });
  console.log(`  ${products.length} products in ${categoryIds.size} categories`);

  // Sales -------------------------------------------------------------------
  let sales: Prisma.SaleCreateManyInput[] = [];
  let items: Prisma.SaleItemCreateManyInput[] = [];
  let payments: Prisma.PaymentCreateManyInput[] = [];
  let movements: Prisma.InventoryMovementCreateManyInput[] = [];
  let txn = 0;
  let totalSales = 0;
  let totalItems = 0;
  let revenue = 0;
  // Per-sale movements only for the recent window, which is what the movement report shows.
  const movementsFrom = todayStart - 90 * DAY_MS;

  const flush = async () => {
    if (sales.length === 0) return;
    await prisma.sale.createMany({ data: sales });
    await prisma.saleItem.createMany({ data: items });
    await prisma.payment.createMany({ data: payments });
    if (movements.length) await prisma.inventoryMovement.createMany({ data: movements });
    totalSales += sales.length;
    totalItems += items.length;
    sales = [];
    items = [];
    payments = [];
    movements = [];
    process.stdout.write(`\r  sales: ${totalSales.toLocaleString()}`);
  };

  const totalDays = (todayStart - periodStart) / DAY_MS;
  for (let day = periodStart; day <= todayStart; day += DAY_MS) {
    const progress = (day - periodStart) / DAY_MS / totalDays;
    const catFactors = new Map((Object.keys(SEASON) as Category[]).map((c) => [c, categoryFactor(c, day)]));
    const traffic = trafficFactor(day, progress);

    for (const store of stores) {
      if (day < store.openedAt) continue;
      // New stores ramp up over their first two months.
      const ramp = Math.min(1, 0.4 + ((day - store.openedAt) / DAY_MS / 60) * 0.6);
      const count = poisson(DAILY * store.size * traffic * ramp);
      const weightOf = (p: (typeof products)[number]) =>
        p.popularity * catFactors.get(p.category)! * (store.affinity[p.category] ?? 1);

      for (let n = 0; n < count; n++) {
        const localHour = 10 + weighted([...HOUR_WEIGHTS.keys()], (h) => HOUR_WEIGHTS[h]);
        const at = day + (localHour - DHAKA_UTC_OFFSET_H) * 3_600_000 + Math.floor(random() * 3_600_000);
        if (at > now) continue; // today: only hours that have already happened

        const saleId = randomUUID();
        const basketSize = weighted([1, 2, 3, 4, 5, 6], (k) => [30, 28, 18, 11, 7, 4][k - 1]);
        const basket = new Set<(typeof products)[number]>();
        for (let k = 0; k < basketSize; k++) basket.add(weighted(products, weightOf));

        let subtotal = 0;
        let discountTotal = 0;
        let taxTotal = 0;
        const status = chance(0.015) ? SaleStatus.CANCELLED : chance(0.01) ? SaleStatus.REFUNDED : SaleStatus.COMPLETED;
        for (const p of basket) {
          const quantity = randInt(1, p.maxQty);
          const gross = p.price * quantity;
          const discount = chance(0.12) ? money(gross * 0.1) : 0;
          const tax = money((gross - discount) * 0.05);
          subtotal += gross;
          discountTotal += discount;
          taxTotal += tax;
          items.push({
            id: randomUUID(),
            saleId,
            productId: p.id,
            quantity,
            unitPrice: p.price,
            discount,
            tax,
            total: money(gross - discount + tax),
          });
          if (status === SaleStatus.COMPLETED) {
            p.soldPerStore.set(store.id, (p.soldPerStore.get(store.id) ?? 0) + quantity);
            if (at >= movementsFrom) {
              movements.push({
                organizationId: orgId,
                productId: p.id,
                locationId: store.id,
                type: MovementType.SALE,
                quantity: -quantity,
                referenceType: "Sale",
                referenceId: saleId,
                createdById: adminId,
                createdAt: new Date(at),
              });
            }
          }
        }

        const total = money(subtotal - discountTotal + taxTotal);
        if (status === SaleStatus.COMPLETED) revenue += total;
        txn++;
        sales.push({
          id: saleId,
          organizationId: orgId,
          storeId: store.id,
          terminalId: store.terminalId,
          transactionNumber: `${tag}-${store.code.replace(`${PREFIX}-`, "")}-${String(txn).padStart(7, "0")}`,
          status,
          subtotal: money(subtotal),
          discount: money(discountTotal),
          tax: money(taxTotal),
          total,
          paymentStatus: status === SaleStatus.REFUNDED ? PaymentStatus.REFUNDED : PaymentStatus.PAID,
          createdById: adminId,
          createdAt: new Date(at),
          updatedAt: new Date(at),
        });
        // bKash/Nagad share grows from ~20% to ~40% over the period.
        const mobileShare = 0.2 + 0.2 * progress;
        payments.push({
          saleId,
          method: weighted(
            [PaymentMethod.CASH, PaymentMethod.CARD, PaymentMethod.MOBILE_PAYMENT],
            (m) => (m === PaymentMethod.MOBILE_PAYMENT ? mobileShare : m === PaymentMethod.CARD ? 0.22 : 0.78 - mobileShare),
          ),
          amount: total,
          status: status === SaleStatus.REFUNDED ? PaymentStatus.REFUNDED : PaymentStatus.PAID,
          createdAt: new Date(at),
        });

        if (sales.length >= BATCH) await flush();
      }
    }
  }
  await flush();
  process.stdout.write("\n");

  // Inventory: current stock from recent sell-through, with some deliberately
  // low or out of stock so the dashboard's stock alerts have something to show.
  const inventory: Prisma.InventoryCreateManyInput[] = [];
  const reorderLevels = new Map<string, number>();
  for (const p of products) {
    const sold = [...p.soldPerStore.values()].reduce((a, b) => a + b, 0);
    const dailyPerStore = sold / Math.max(1, totalDays) / Math.max(1, stores.length);
    const reorderLevel = Math.max(3, Math.round(dailyPerStore * 7));
    reorderLevels.set(p.id, reorderLevel);
    for (const store of stores) {
      const roll = random();
      const quantity =
        roll < 0.05 ? 0 : roll < 0.15 ? randInt(1, reorderLevel) : reorderLevel + Math.round(dailyPerStore * randInt(5, 30));
      inventory.push({ organizationId: orgId, productId: p.id, locationId: store.id, quantity });
    }
    inventory.push({
      organizationId: orgId,
      productId: p.id,
      locationId: warehouse.id,
      quantity: Math.round(dailyPerStore * stores.length * randInt(30, 60)) + 20,
    });
  }
  for (const p of products) {
    await prisma.product.update({ where: { id: p.id }, data: { reorderLevel: reorderLevels.get(p.id) } });
  }
  await prisma.inventory.createMany({ data: inventory });
  console.log(`  ${inventory.length} inventory rows`);

  // Transfers: fortnightly warehouse → store restocks, plus a few open ones.
  let transferCount = 0;
  const transferMovements: Prisma.InventoryMovementCreateManyInput[] = [];
  const createTransfer = async (store: (typeof stores)[number], at: number, status: TransferStatus) => {
    transferCount++;
    const picked = new Set<(typeof products)[number]>();
    for (let k = 0; k < randInt(3, 8); k++) picked.add(weighted(products, (p) => p.popularity));
    const lines = [...picked].map((p) => ({ productId: p.id, quantity: randInt(10, 60) }));
    const received = status === TransferStatus.RECEIVED;
    const transfer = await prisma.stockTransfer.create({
      data: {
        organizationId: orgId,
        transferNumber: `${tag}-TRF-${String(transferCount).padStart(5, "0")}`,
        sourceLocationId: warehouse.id,
        destinationLocationId: store.id,
        status,
        createdById: adminId,
        receivedById: received ? adminId : null,
        notes: `Restock for ${store.name}`,
        createdAt: new Date(at),
        approvedAt: status === TransferStatus.PENDING ? null : new Date(at + 3_600_000),
        shippedAt: received || status === TransferStatus.IN_TRANSIT ? new Date(at + 4 * 3_600_000) : null,
        receivedAt: received ? new Date(at + DAY_MS) : null,
        items: { create: lines.map((l) => ({ ...l, receivedQuantity: received ? l.quantity : 0 })) },
      },
    });
    if (received && at >= movementsFrom) {
      for (const l of lines) {
        const base = { organizationId: orgId, productId: l.productId, referenceType: "StockTransfer", referenceId: transfer.id, createdById: adminId };
        transferMovements.push(
          { ...base, locationId: warehouse.id, type: MovementType.TRANSFER_OUT, quantity: -l.quantity, createdAt: new Date(at + 4 * 3_600_000) },
          { ...base, locationId: store.id, type: MovementType.TRANSFER_IN, quantity: l.quantity, createdAt: new Date(at + DAY_MS) },
        );
      }
    }
  };
  for (const store of stores) {
    for (let at = store.openedAt + randInt(0, 13) * DAY_MS; at < todayStart - 2 * DAY_MS; at += 14 * DAY_MS) {
      await createTransfer(store, at + 9 * 3_600_000, TransferStatus.RECEIVED);
    }
  }
  const open = [TransferStatus.PENDING, TransferStatus.PENDING, TransferStatus.APPROVED, TransferStatus.IN_TRANSIT, TransferStatus.IN_TRANSIT];
  for (const [i, status] of open.entries()) {
    await createTransfer(stores[i % stores.length], now - randInt(2, 40) * 3_600_000, status);
  }
  if (transferMovements.length) await prisma.inventoryMovement.createMany({ data: transferMovements });
  console.log(`  ${transferCount} stock transfers (${open.length} still open)`);

  console.log(
    `  ${totalSales.toLocaleString()} sales, ${totalItems.toLocaleString()} line items, ` +
      `৳${Math.round(revenue).toLocaleString()} completed revenue`,
  );
}

/** Rebuilds this organization's OLAP star schema with the API's own ETL. */
async function refreshOlap(orgId: string) {
  for (const stmt of STAR_SCHEMA_DDL) await prisma.$executeRawUnsafe(stmt);
  await prisma.$transaction(
    async (tx) => {
      for (const stmt of ETL_STATEMENTS) await tx.$executeRawUnsafe(stmt, orgId);
      await tx.$executeRawUnsafe(
        `INSERT INTO olap.etl_runs (org_id, refreshed_at, fact_rows)
         SELECT $1, now(), COUNT(*) FROM olap.fact_sales WHERE org_id = $1
         ON CONFLICT (org_id) DO UPDATE SET refreshed_at = EXCLUDED.refreshed_at, fact_rows = EXCLUDED.fact_rows`,
        orgId,
      );
    },
    { timeout: 300_000 },
  );
  const [row] = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
    `SELECT COUNT(*) AS n FROM olap.fact_sales WHERE org_id = $1`,
    orgId,
  );
  console.log(`  OLAP cube refreshed: ${Number(row.n).toLocaleString()} fact rows`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  if (!flag("seed") && !flag("clean")) {
    console.log("Usage: tsx scripts/seed-analytics.ts --seed [--months 18] [--daily 22] [--org DEMO] [--rng N]");
    console.log("       tsx scripts/seed-analytics.ts --clean [--org DEMO]");
    return;
  }

  const org = await prisma.organization.findUnique({ where: { code: orgCode } });
  if (!org) throw new Error(`Organization "${orgCode}" not found. Run the base seed first: npm run db:seed`);
  const admin = await prisma.user.findFirst({ where: { organizationId: org.id }, orderBy: { createdAt: "asc" } });

  const started = Date.now();
  console.log(`\nRemoving previous ${PREFIX}- analytics data from ${org.code}...`);
  await clean(org.id);
  if (flag("seed")) {
    console.log(`\nSeeding analytics data into ${org.code}...`);
    await seed(org.id, admin?.id ?? null);
  }
  await refreshOlap(org.id);
  console.log(`\nDone in ${Math.round((Date.now() - started) / 1000)}s.\n`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
