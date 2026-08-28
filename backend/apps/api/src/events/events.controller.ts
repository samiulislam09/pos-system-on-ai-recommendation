import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { eventBatchSchema, paginationSchema, posEventSchema } from "@inv/validation";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { EventsService } from "./events.service";
import {
  CurrentUser,
  Public,
  RequirePermission,
  type AuthUser,
} from "../common/decorators/auth.decorator";

/**
 * POS event ingestion. Endpoints are authenticated via JWT (or terminal token)
 * and are fully idempotent keyed on `eventId`.
 */
@Controller("events")
export class EventsController {
  constructor(private readonly eventsService: EventsService) {}

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(posEventSchema)) body: unknown,
  ) {
    return this.eventsService.process(body as never, user);
  }

  @Post("batch")
  createBatch(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(eventBatchSchema)) body: { events: never[] },
  ) {
    return this.eventsService.processBatch(body.events as never, user);
  }

  @Get()
  @RequirePermission("sales.read")
  list(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(paginationSchema)) query: { page: number; limit: number },
  ) {
    return this.eventsService.listEvents(user.organizationId!, query.page, query.limit);
  }

  @Get(":eventId")
  @RequirePermission("sales.read")
  get(@Param("eventId") eventId: string, @CurrentUser() user: AuthUser) {
    return this.eventsService.getEvent(user.organizationId!, eventId);
  }
}
