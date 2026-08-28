import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type EventStatus = "PENDING" | "PROCESSING" | "SYNCED" | "FAILED";

export interface EdgeEventRow {
  id: string;
  event_id: string;
  payload: string;
  status: EventStatus;
  attempts: number;
  next_retry_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
  synced_at: string | null;
}

export class EdgeDb {
  private db: DatabaseSync;

  constructor(dbPath: string) {
    if (dbPath !== ":memory:") {
      mkdirSync(dirname(dbPath), { recursive: true });
    }
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        event_id TEXT UNIQUE NOT NULL,
        payload TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'PENDING',
        attempts INTEGER NOT NULL DEFAULT 0,
        next_retry_at TEXT,
        last_error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        synced_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_events_status ON events(status, next_retry_at);
      CREATE TABLE IF NOT EXISTS sync_state (
        key TEXT PRIMARY KEY,
        value TEXT
      );
    `);
  }

  insert(eventId: string, payload: unknown): EdgeEventRow {
    const now = new Date().toISOString();
    const row = {
      id: crypto.randomUUID(),
      event_id: eventId,
      payload: JSON.stringify(payload),
      status: "PENDING" as EventStatus,
      attempts: 0,
      next_retry_at: null,
      last_error: null,
      created_at: now,
      updated_at: now,
      synced_at: null,
    };
    this.db
      .prepare(
        `INSERT INTO events (id, event_id, payload, status, attempts, next_retry_at, last_error, created_at, updated_at, synced_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        row.id,
        row.event_id,
        row.payload,
        row.status,
        row.attempts,
        row.next_retry_at,
        row.last_error,
        row.created_at,
        row.updated_at,
        row.synced_at,
      );
    return row;
  }

  findByEventId(eventId: string): EdgeEventRow | null {
    const rows = this.db
      .prepare("SELECT * FROM events WHERE event_id = ?")
      .all(eventId) as unknown as EdgeEventRow[];
    return rows[0] ?? null;
  }

  dueEvents(limit: number, now: Date): EdgeEventRow[] {
    return this.db
      .prepare(
        `SELECT * FROM events
         WHERE status IN ('PENDING','FAILED')
           AND (next_retry_at IS NULL OR next_retry_at <= ?)
         ORDER BY created_at ASC
         LIMIT ?`,
      )
      .all(now.toISOString(), limit) as unknown as EdgeEventRow[];
  }

  markProcessing(ids: string[], now: Date): void {
    for (const id of ids) {
      this.db
        .prepare("UPDATE events SET status = 'PROCESSING', updated_at = ? WHERE id = ?")
        .run(now.toISOString(), id);
    }
  }

  markSynced(id: string, now: Date): void {
    this.db
      .prepare(
        "UPDATE events SET status = 'SYNCED', synced_at = ?, next_retry_at = NULL, last_error = NULL, updated_at = ? WHERE id = ?",
      )
      .run(now.toISOString(), now.toISOString(), id);
  }

  markFailed(id: string, attempts: number, nextRetryAt: Date | null, error: string, now: Date): void {
    this.db
      .prepare(
        `UPDATE events SET status = 'FAILED', attempts = ?, next_retry_at = ?, last_error = ?, updated_at = ? WHERE id = ?`,
      )
      .run(attempts, nextRetryAt ? nextRetryAt.toISOString() : null, error.slice(0, 500), now.toISOString(), id);
  }

  counts(): { pending: number; synced: number; failed: number; processing: number } {
    const rows = this.db
      .prepare("SELECT status, COUNT(*) AS count FROM events GROUP BY status")
      .all() as unknown as { status: EventStatus; count: number }[];
    const out = { pending: 0, synced: 0, failed: 0, processing: 0 };
    for (const r of rows) {
      if (r.status === "PENDING") out.pending = r.count;
      if (r.status === "SYNCED") out.synced = r.count;
      if (r.status === "FAILED") out.failed = r.count;
      if (r.status === "PROCESSING") out.processing = r.count;
    }
    return out;
  }

  getState(key: string): string | null {
    const rows = this.db.prepare("SELECT value FROM sync_state WHERE key = ?").all(key) as unknown as {
      value: string;
    }[];
    return rows[0]?.value ?? null;
  }

  setState(key: string, value: string): void {
    this.db
      .prepare("INSERT INTO sync_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(key, value);
  }

  close(): void {
    this.db.close();
  }
}