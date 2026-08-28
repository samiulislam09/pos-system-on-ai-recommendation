import { Controller, Get, Query } from "@nestjs/common";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { ReportsService } from "./reports.service";
import {
  CurrentUser,
  RequirePermission,
  type AuthUser,
} from "../common/decorators/auth.decorator";
import { z } from "zod";

const rangeSchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

type RangeQuery = z.infer<typeof rangeSchema>;

@Controller("reports")
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get("overview")
  @RequirePermission("reports.read")
  overview(@CurrentUser() user: AuthUser) {
    return this.reportsService.overview(user.organizationId!);
  }

  @Get("sales")
  @RequirePermission("reports.read")
  sales(@CurrentUser() user: AuthUser, @Query(new ZodValidationPipe(rangeSchema)) query: RangeQuery) {
    const { from, to } = this.resolveRange(query);
    return this.reportsService.salesByDay(user.organizationId!, from, to);
  }

  @Get("stores")
  @RequirePermission("reports.read")
  stores(@CurrentUser() user: AuthUser, @Query(new ZodValidationPipe(rangeSchema)) query: RangeQuery) {
    const { from, to } = this.resolveRange(query);
    return this.reportsService.salesByStore(user.organizationId!, from, to);
  }

  @Get("top-products")
  @RequirePermission("reports.read")
  topProducts(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(rangeSchema)) query: RangeQuery,
    @Query("limit") limit?: string,
  ) {
    const { from, to } = this.resolveRange(query);
    const parsed = Math.min(Math.max(parseInt(limit ?? "10", 10) || 10, 1), 100);
    return this.reportsService.topProducts(user.organizationId!, from, to, parsed);
  }

  @Get("inventory")
  @RequirePermission("reports.read")
  inventory(@CurrentUser() user: AuthUser, @Query("locationId") locationId?: string) {
    return this.reportsService.inventoryReport(user.organizationId!, locationId);
  }

  @Get("movements")
  @RequirePermission("reports.read")
  movements(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(rangeSchema)) query: RangeQuery,
    @Query("type") type?: string,
  ) {
    const { from, to } = this.resolveRange(query);
    return this.reportsService.movementReport(user.organizationId!, from, to, type);
  }

  @Get("adjustments")
  @RequirePermission("reports.read")
  adjustments(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(rangeSchema)) query: RangeQuery,
  ) {
    const { from, to } = this.resolveRange(query);
    return this.reportsService.adjustmentReport(user.organizationId!, from, to);
  }

  @Get("purchases")
  @RequirePermission("reports.read")
  purchases(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(rangeSchema)) query: RangeQuery,
  ) {
    const { from, to } = this.resolveRange(query);
    return this.reportsService.purchaseReport(user.organizationId!, from, to);
  }

  @Get("transfers")
  @RequirePermission("reports.read")
  transfers(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(rangeSchema)) query: RangeQuery,
  ) {
    const { from, to } = this.resolveRange(query);
    return this.reportsService.transferReport(user.organizationId!, from, to);
  }

  @Get("returns")
  @RequirePermission("reports.read")
  returns(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(rangeSchema)) query: RangeQuery,
  ) {
    const { from, to } = this.resolveRange(query);
    return this.reportsService.returnReport(user.organizationId!, from, to);
  }

  private resolveRange(query: RangeQuery) {
    const to = query.to ? new Date(query.to) : new Date();
    const from = query.from ? new Date(query.from) : new Date(to.getTime() - 30 * 24 * 3600 * 1000);
    return { from, to };
  }
}