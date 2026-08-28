import { Controller, Get, Param, Query } from "@nestjs/common";
import { paginationSchema } from "@inv/validation";
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

  @Get(":id")
  @RequirePermission("sales.read")
  get(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    return this.salesService.get(user.organizationId!, id);
  }
}