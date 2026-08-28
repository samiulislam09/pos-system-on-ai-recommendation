import { Injectable, Logger } from "@nestjs/common";
import { Queue } from "bullmq";
import { ConfigService } from "@nestjs/config";
import { QUEUES, JOB_NAMES, BULLMQ_DEFAULT_OPTS } from "@inv/events";

/**
 * Publishes non-critical background work (analytics, alerts, reconciliation).
 * Critical inventory operations are NOT routed here — they run synchronously
 * in the API transaction path to preserve strong consistency (spec §20).
 *
 * The publisher is guarded: if Redis is unavailable the API keeps working.
 */
@Injectable()
export class QueueService {
  private readonly logger = new Logger("QueueService");
  private queues: Partial<Record<(typeof QUEUES)[keyof typeof QUEUES], Queue>> = {};

  constructor(private readonly config: ConfigService) {
    this.init();
  }

  private init() {
    try {
      const redisUrl = this.config.get<string>("REDIS_URL") ?? "redis://localhost:6379";
      for (const name of Object.values(QUEUES)) {
        this.queues[name] = new Queue(name, {
          connection: { url: redisUrl, maxRetriesPerRequest: null },
          ...BULLMQ_DEFAULT_OPTS,
        });
      }
    } catch (e) {
      this.logger.warn(`Redis unavailable, background queues disabled: ${(e as Error).message}`);
    }
  }

  private push(queueName: keyof typeof QUEUES, jobName: string, data: Record<string, unknown>) {
    const queue = this.queues[QUEUES[queueName]];
    if (!queue) return;
    queue.add(jobName, data).catch((e) => {
      this.logger.warn(`Failed to enqueue ${jobName}: ${e.message}`);
    });
  }

  enqueueLowStockCheck(organizationId: string) {
    this.push("ANALYTICS", JOB_NAMES.LOW_STOCK_ALERT, { organizationId });
  }

  enqueueReconcile(organizationId: string) {
    this.push("ANALYTICS", JOB_NAMES.RECONCILE_INVENTORY, { organizationId });
  }

  enqueueDailySales(day?: string) {
    this.push("ANALYTICS", JOB_NAMES.AGGREGATE_DAILY_SALES, day ? { day } : {});
  }
}