import { Controller, Get, Param, Query, Res } from "@nestjs/common";
import type { Response } from "express";
import { paginationSchema, salesExportQuerySchema } from "@inv/validation";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { SalesService } from "./sales.service";
import {
  CurrentUser,
  RequirePermission,
  type AuthUser,
} from "../common/decorators/auth.decorator";

@Controller("sales")
export class SalesController {
  constructor(private readonly salesService: SalesService) {}

  @Get()
  @RequirePermission("sales.read")
  list(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(paginationSchema)) query: {
      page: number;
      limit: number;
      from?: string;
      to?: string;
    },
    @Query("storeId") storeId?: string,
    @Query("status") status?: string,
  ) {
    return this.salesService.list(user.organizationId!, query.page, query.limit, {
      storeId,
      status,
      from: query.from,
      to: query.to,
    });
  }

  // Declared before ":id" so "export" is not captured as a sale id.
  @Get("export")
  @RequirePermission("sales.read")
  async export(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(salesExportQuerySchema)) query: {
      storeId?: string;
      from?: string;
      to?: string;
    },
    @Res() res: Response,
  ) {
    const csv = await this.salesService.exportCsv(user.organizationId!, query);
    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="sales-${stamp}.csv"`);
    res.send(csv);
  }

  @Get(":id")
  @RequirePermission("sales.read")
  get(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    return this.salesService.get(user.organizationId!, id);
  }
}