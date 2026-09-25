import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { MessageEvent } from "@nestjs/common";
import Redis from "ioredis";
import { Observable, Subject, filter, interval, map, merge } from "rxjs";

const CHANNEL = "portal-notifications";
const HEARTBEAT_MS = 25_000;

/** Who a live event is for: a supplier-portal user or a staff (vendor) user. */
export type StreamAudience = "supplier" | "staff";

/** Pushed to the recipient's browser; it then refetches what it shows. */
export interface StreamEvent {
  audience: StreamAudience;
  recipientId: string;
  /** Set when a new notification was created, so the browser can pop a toast. */
  message?: string;
}

/**
 * Live notification feed over Server-Sent Events, for supplier users and for
 * staff users.
 *
 * Events go through Redis pub/sub so every API instance hears them. If Redis
 * is unavailable, events are delivered in-process only (fine for a single
 * instance); the stream never breaks the request that triggered it.
 */
@Injectable()
export class NotificationStream implements OnModuleDestroy {
  private readonly logger = new Logger("NotificationStream");
  private readonly events = new Subject<StreamEvent>();
  private readonly pub: Redis;
  private readonly sub: Redis;

  constructor(config: ConfigService) {
    const url = config.get<string>("REDIS_URL") ?? "redis://localhost:6379";
    this.pub = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 1 });
    this.sub = new Redis(url, { lazyConnect: true });
    for (const client of [this.pub, this.sub]) {
      client.on("error", (e) => this.logger.warn(`Redis: ${e.message}`));
    }
    this.sub.on("message", (_channel, raw) => {
      try {
        this.events.next(JSON.parse(raw) as StreamEvent);
      } catch {
        // Ignore malformed messages.
      }
    });
    this.sub
      .connect()
      .then(() => this.sub.subscribe(CHANNEL))
      .catch((e) => this.logger.warn(`Live notifications are in-process only: ${e.message}`));
    this.pub.connect().catch(() => undefined);
  }

  /** Tell a recipient's open browsers that their notifications changed. */
  publish(event: StreamEvent): void {
    if (this.pub.status === "ready" && this.sub.status === "ready") {
      this.pub.publish(CHANNEL, JSON.stringify(event)).catch((e) => {
        this.logger.warn(`Publish failed, delivering locally: ${e.message}`);
        this.events.next(event);
      });
    } else {
      this.events.next(event);
    }
  }

  /** SSE stream for one recipient, with a heartbeat to keep proxies from timing out. */
  stream(audience: StreamAudience, recipientId: string): Observable<MessageEvent> {
    const updates = this.events.pipe(
      filter((e) => e.audience === audience && e.recipientId === recipientId),
      map((e): MessageEvent => ({ type: "notification", data: { message: e.message ?? null } })),
    );
    const heartbeat = interval(HEARTBEAT_MS).pipe(
      map((): MessageEvent => ({ type: "ping", data: {} })),
    );
    return merge(updates, heartbeat);
  }

  onModuleDestroy() {
    this.events.complete();
    this.pub.disconnect();
    this.sub.disconnect();
  }
}
