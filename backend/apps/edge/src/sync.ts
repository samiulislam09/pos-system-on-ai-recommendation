import { EdgeDb } from "./db";

export interface SyncConfig {
  apiUrl: string;
  token: string;
  batchSize: number;
  maxRetryDelayMs: number;
}

/**
 * Push pending events to the central API with exponential backoff.
 * The central API is idempotent keyed on `eventId`, so retries are safe.
 */
export class SyncEngine {
  constructor(
    private readonly db: EdgeDb,
    private readonly config: SyncConfig,
  ) {}

  async syncOnce(): Promise<{ synced: number; failed: number; skipped: number }> {
    const now = new Date();
    const events = this.db.dueEvents(this.config.batchSize, now);
    if (events.length === 0) {
      return { synced: 0, failed: 0, skipped: 0 };
    }

    this.db.markProcessing(
      events.map((e) => e.id),
      now,
    );

    let synced = 0;
    let failed = 0;
    let skipped = 0;

    for (const event of events) {
      const attempt = event.attempts + 1;
      try {
        const result = await this.push(event.payload);
        if (result.ok) {
          this.db.markSynced(event.id, new Date());
          this.db.setState("lastSuccessfulSync", new Date().toISOString());
          synced++;
        } else if (result.code === "DUPLICATE_EVENT") {
          // Already processed server-side; treat as synced.
          this.db.markSynced(event.id, new Date());
          this.db.setState("lastSuccessfulSync", new Date().toISOString());
          synced++;
        } else if (result.status === 401 || result.status === 403) {
          // Auth failure — do not hammer the API, requeue with a long delay.
          const retryAt = new Date(Date.now() + 60_000);
          this.db.markFailed(event.id, attempt, retryAt, result.message, new Date());
          this.db.setState("lastError", `${result.status} ${result.message}`);
          failed++;
        } else {
          const retryAt = this.backoffDelay(attempt);
          this.db.markFailed(event.id, attempt, retryAt, result.message, new Date());
          this.db.setState("lastError", `${result.status} ${result.message}`);
          failed++;
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        const retryAt = this.backoffDelay(attempt);
        this.db.markFailed(event.id, attempt, retryAt, msg, new Date());
        this.db.setState("lastError", msg);
        failed++;
      }
      this.db.setState("lastAttempt", new Date().toISOString());
    }

    return { synced, failed, skipped };
  }

  private backoffDelay(attempt: number): Date {
    const schedule = [1000, 2000, 4000, 8000, 16000, 30000, 60000];
    const delay = Math.min(schedule[attempt - 1] ?? 60000, this.config.maxRetryDelayMs);
    return new Date(Date.now() + delay);
  }

  private async push(payload: string): Promise<{
    ok: boolean;
    status?: number;
    code?: string;
    message: string;
  }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
      const res = await fetch(`${this.config.apiUrl}/events`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.config.token}`,
        },
        body: payload,
        signal: controller.signal,
      });
      const body = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        data?: { status?: string };
        error?: { code?: string; message?: string };
      };
      if (res.ok && body.success) {
        return { ok: true, message: body.data?.status ?? "ok" };
      }
      return {
        ok: false,
        status: res.status,
        code: body.error?.code,
        message: body.error?.message ?? `HTTP ${res.status}`,
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}