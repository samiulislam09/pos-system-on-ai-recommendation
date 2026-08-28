import { Worker, Job } from "bullmq";
import { PrismaClient, Prisma } from "@inv/database";
import { QUEUES, JOB_NAMES } from "@inv/events";
import Redis from "ioredis";

const prisma = new PrismaClient();
const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";

const connection = new Redis(redisUrl, {
  maxRetriesPerRequest: null,
});

const logger = {
  info: (...a: unknown[]) => console.log(new Date().toISOString(), "INFO", ...a),
  error: (...a: unknown[]) => console.error(new Date().toISOString(), "ERROR", ...a),
  warn: (...a: unknown[]) => console.warn(new Date().toISOString(), "WARN", ...a),
};

// ---------------------------------------------------------------------------
// Job handlers — non-critical work only. Critical inventory ops stay
// strongly-consistent in the API transaction path (spec §20).
// ---------------------------------------------------------------------------

async function reconcileInventory(_job: Job<{ organizationId?: string }>) {
  const orgs = _job.data.organizationId
    ? [{ id: _job.data.organizationId }]
    : await prisma.organization.findMany({ select: { id: true } });

  let mismatches = 0;
  for (const org of orgs) {
    const rows = await prisma.$queryRaw<
      { inventoryId: string; productId: string; locationId: string; balance: number; ledger: number }[]
    >`
      SELECT inv.id AS "inventoryId", inv."productId", inv."locationId",
             inv.quantity AS balance,
             COALESCE(SUM(m.quantity), 0)::int AS ledger
      FROM "Inventory" inv
      LEFT JOIN "InventoryMovement" m
        ON m."productId" = inv."productId" AND m."locationId" = inv."locationId"
      WHERE inv."organizationId" = ${org.id}
      GROUP BY inv.id, inv."productId", inv."locationId", inv.quantity
    `;
    for (const row of rows) {
      if (row.balance !== row.ledger) {
        mismatches++;
        await prisma.auditLog.create({
          data: {
            organizationId: org.id,
            action: "INVENTORY_RECONCILIATION_MISMATCH",
            entity: "Inventory",
            entityId: row.inventoryId,
            metadata: {
              balance: row.balance,
              ledger: row.ledger,
              productId: row.productId,
              locationId: row.locationId,
            },
          },
        });
      }
    }
  }
  logger.info(`[reconcile] ${orgs.length} orgs checked, ${mismatches} mismatch(es)`);
  return { organizations: orgs.length, mismatches };
}

async function lowStockAlert(_job: Job<{ organizationId?: string }>) {
  const orgs = _job.data.organizationId
    ? [{ id: _job.data.organizationId }]
    : await prisma.organization.findMany({ select: { id: true } });

  for (const org of orgs) {
    const lowStock = await prisma.$queryRaw<{ productId: string; sku: string; quantity: number; reorderLevel: number }[]>`
      SELECT inv."productId", p.sku, inv.quantity, p."reorderLevel"
      FROM "Inventory" inv
      JOIN "Product" p ON p.id = inv."productId"
      WHERE inv."organizationId" = ${org.id}
        AND inv.quantity <= p."reorderLevel"
      ORDER BY inv.quantity ASC
    `;
    if (lowStock.length > 0) {
      await prisma.auditLog.create({
        data: {
          organizationId: org.id,
          action: "LOW_STOCK_ALERT",
          entity: "Inventory",
          entityId: "batch",
          metadata: {
            count: lowStock.length,
            items: lowStock.slice(0, 50).map((r) => ({
              sku: r.sku,
              quantity: r.quantity,
              reorderLevel: r.reorderLevel,
            })),
          },
        },
      });
      logger.info(`[low-stock] org ${org.id}: ${lowStock.length} product(s) low on stock`);
    }
  }
  return { organizations: orgs.length };
}

async function aggregateDailySales(job: Job<{ day?: string }>) {
  const day = job.data.day ?? new Date(Date.now() - 24 * 3600 * 1000).toISOString().slice(0, 10);
  const from = new Date(`${day}T00:00:00Z`);
  const to = new Date(new Date(from).setUTCDate(from.getUTCDate() + 1));

  const rows = await prisma.$queryRaw<
    { organizationId: string; storeId: string; total: Prisma.Decimal; transactions: bigint }[]
  >`
    SELECT "organizationId", "storeId", COALESCE(SUM(total), 0)::numeric(12,2) AS total,
           COUNT(*)::bigint AS transactions
    FROM "Sale"
    WHERE status = 'COMPLETED' AND "createdAt" >= ${from} AND "createdAt" < ${to}
    GROUP BY "organizationId", "storeId"
  `;

  // Historical daily store sales — the AI-ready dataset (§26).
  for (const row of rows) {
    logger.info(
      `[daily-sales] ${day} org=${row.organizationId} store=${row.storeId} ` +
        `transactions=${Number(row.transactions)} total=${Number(row.total)}`,
    );
  }
  return { day, stores: rows.length };
}

const handlers: Record<string, (job: Job) => Promise<unknown>> = {
  [JOB_NAMES.RECONCILE_INVENTORY]: reconcileInventory,
  [JOB_NAMES.LOW_STOCK_ALERT]: lowStockAlert,
  [JOB_NAMES.AGGREGATE_DAILY_SALES]: aggregateDailySales,
};

function startWorker(queue: string) {
  const worker = new Worker(
    queue,
    async (job) => {
      const handler = handlers[job.name];
      if (!handler) {
        logger.warn(`[worker] no handler for job ${job.name} on queue ${queue}`);
        return;
      }
      logger.info(`[worker] processing ${job.name} (${job.id})`);
      return handler(job);
    },
    {
      connection,
      concurrency: 5,
      limiter: { max: 20, duration: 1000 },
    },
  );

  worker.on("completed", (job) => {
    logger.info(`[worker] completed ${job.name} (${job.id})`);
  });
  worker.on("failed", (job, err) => {
    logger.error(`[worker] failed ${job?.name} (${job?.id}): ${err.message}`);
  });
  worker.on("error", (err) => {
    logger.error(`[worker] error on queue ${queue}: ${err.message}`);
  });

  logger.info(`[worker] listening on queue '${queue}'`);
}

const queues = process.env.WORKER_QUEUES
  ? process.env.WORKER_QUEUES.split(",").map((q) => q.trim())
  : [QUEUES.ANALYTICS, QUEUES.NOTIFICATIONS];

for (const queue of queues) {
  startWorker(queue);
}

process.on("SIGINT", () => {
  logger.info("[worker] shutting down");
  connection.disconnect();
  process.exit(0);
});