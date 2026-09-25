import { Controller, Get, Param, Post, Sse, type MessageEvent } from "@nestjs/common";
import type { Observable } from "rxjs";
import { CurrentUser, type AuthUser } from "../common/decorators/auth.decorator";
import { NotificationStream } from "./notification-stream.service";
import { VendorNotificationsService } from "./vendor-notifications.service";

/** The signed-in staff user's own notifications; no extra permission needed. */
@Controller("notifications")
export class VendorNotificationsController {
  constructor(
    private readonly notifications: VendorNotificationsService,
    private readonly stream: NotificationStream,
  ) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.notifications.list(user);
  }

  /** Live feed: an event whenever this user's notifications change. */
  @Sse("stream")
  events(@CurrentUser() user: AuthUser): Observable<MessageEvent> {
    return this.stream.stream("staff", user.id);
  }

  @Post("read-all")
  markAllRead(@CurrentUser() user: AuthUser) {
    return this.notifications.markAllRead(user);
  }

  @Post(":id/read")
  markRead(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.notifications.markRead(user, id);
  }
}
