import { Body, Controller, Get, Post, Query } from "@nestjs/common";
import { z } from "zod";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import {
  CurrentUser,
  RequirePermission,
  type AuthUser,
} from "../common/decorators/auth.decorator";
import { OlapService } from "./olap.service";
import { LEVEL_KEYS, MEASURE_KEYS } from "./olap.cube";

const membersSchema = z.object({ level: z.enum(LEVEL_KEYS) });

const querySchema = z.object({
  measure: z.enum(MEASURE_KEYS),
  rows: z.enum(LEVEL_KEYS),
  cols: z.enum(LEVEL_KEYS).nullable().optional(),
  filters: z
    .array(z.object({ level: z.enum(LEVEL_KEYS), values: z.array(z.string()).min(1).max(500) }))
    .max(10)
    .default([]),
});

@Controller("olap")
export class OlapController {
  constructor(private readonly olapService: OlapService) {}

  @Get("status")
  @RequirePermission("reports.read")
  status(@CurrentUser() user: AuthUser) {
    return this.olapService.status(user.organizationId!);
  }

  @Post("refresh")
  @RequirePermission("reports.read")
  refresh(@CurrentUser() user: AuthUser) {
    return this.olapService.refresh(user.organizationId!);
  }

  @Get("members")
  @RequirePermission("reports.read")
  members(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(membersSchema)) query: z.infer<typeof membersSchema>,
  ) {
    return this.olapService.members(user.organizationId!, query.level);
  }

  @Post("query")
  @RequirePermission("reports.read")
  query(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(querySchema)) body: z.infer<typeof querySchema>,
  ) {
    return this.olapService.query(user.organizationId!, body);
  }
}
