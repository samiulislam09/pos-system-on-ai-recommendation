import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { EdgeDb, EdgeEventRow } from "./db";
import { posEventSchema } from "@inv/validation";

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

export interface EdgeStatus {
  pendingEvents: number;
  syncedEvents: number;
  failedEvents: number;
  processingEvents: number;
  lastSuccessfulSync: string | null;
  lastAttempt: string | null;
  lastError: string | null;
}

export class EdgeServer {
  constructor(
    private readonly db: EdgeDb,
    private readonly port: number,
  ) {}

  start(): void {
    const server = createServer(async (req, res) => {
      const url = new URL(req.url ?? "/", `http://localhost:${this.port}`);
      try {
        if (req.method === "GET" && url.pathname === "/status") {
          return this.handleStatus(res);
        }
        if (req.method === "POST" && (url.pathname === "/events" || url.pathname === "/events/batch")) {
          const raw = await readBody(req);
          return this.handleEvents(raw, res);
        }
        return send(res, 404, { success: false, error: { code: "NOT_FOUND", message: "Not found" } });
      } catch (error) {
        return send(res, 500, {
          success: false,
          error: { code: "INTERNAL_ERROR", message: error instanceof Error ? error.message : "error" },
        });
      }
    });

    server.listen(this.port, () => {
      console.log(`[edge] local POS API listening on http://localhost:${this.port}`);
    });
  }

  private handleStatus(res: ServerResponse): void {
    const counts = this.db.counts();
    const status: EdgeStatus = {
      pendingEvents: counts.pending,
      syncedEvents: counts.synced,
      failedEvents: counts.failed,
      processingEvents: counts.processing,
      lastSuccessfulSync: this.db.getState("lastSuccessfulSync"),
      lastAttempt: this.db.getState("lastAttempt"),
      lastError: this.db.getState("lastError"),
    };
    send(res, 200, { success: true, data: status });
  }

  private handleEvents(raw: string, res: ServerResponse): void {
    const parsed = JSON.parse(raw);
    const events = Array.isArray(parsed) ? parsed : [parsed];

    if (events.length === 0) {
      return send(res, 400, { success: false, error: { code: "BAD_REQUEST", message: "Empty batch" } });
    }

    const created: { eventId: string; status: string }[] = [];
    const duplicates: string[] = [];

    for (const event of events) {
      const result = posEventSchema.safeParse(event);
      if (!result.success) {
        return send(res, 400, {
          success: false,
          error: {
            code: "VALIDATION_ERROR",
            message: "Invalid event",
            details: result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
          },
        });
      }
      const existing = this.db.findByEventId(result.data.eventId);
      if (existing) {
        duplicates.push(existing.event_id);
        continue;
      }
      this.db.insert(result.data.eventId, result.data);
      created.push({ eventId: result.data.eventId, status: "PENDING" });
    }

    return send(res, 201, {
      success: true,
      data: {
        accepted: created,
        duplicates,
        queued: created.length,
      },
    });
  }
}