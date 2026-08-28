import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
} from "@nestjs/common";
import { adjustInventorySchema, paginationSchema } from "@inv/validation";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { InventoryService } from "./inventory.service";
import { InventoryEngine } from "./inventory-engine.service";
import {
  CurrentUser,
  RequirePermission,
  type AuthUser,
} from "../common/decorators/auth.decorator";

@Controller("inventory")
export class InventoryController {
  constructor(
    private readonly inventoryService: InventoryService,
    private readonly engine: InventoryEngine,
  ) {}

  @Get()
  @RequirePermission("inventory.read")
  list(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(paginationSchema)) query: { page: number; limit: number },
    @Query("locationId") locationId?: string,
    @Query("categoryId") categoryId?: string,
    @Query("brandId") brandId?: string,
    @Query("productId") productId?: string,
    @Query("stockStatus") stockStatus?: "IN_STOCK" | "LOW_STOCK" | "OUT_OF_STOCK",
  ) {
    return this.inventoryService.list(user.organizationId!, query.page, query.limit, {
      locationId,
      categoryId,
      brandId,
      productId,
      stockStatus,
    });
  }

  @Get("summary")
  @RequirePermission("inventory.read")
  summary(@CurrentUser() user: AuthUser) {
    return this.inventoryService.summary(user.organizationId!);
  }

  @Get(":productId")
  @RequirePermission("inventory.read")
  getForProduct(@Param("productId") productId: string, @CurrentUser() user: AuthUser) {
    return this.inventoryService.getForProduct(user.organizationId!, productId);
  }

  @Get(":productId/movements")
  @RequirePermission("inventory.read")
  movements(
    @Param("productId") productId: string,
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(paginationSchema)) query: { page: number; limit: number },
  ) {
    return this.inventoryService.movements(user.organizationId!, productId, query.page, query.limit);
  }

  @Post("adjust")
  @RequirePermission("inventory.adjust")
  adjust(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(adjustInventorySchema)) body: unknown,
  ) {
    return this.inventoryService.adjust(user.organizationId!, body as never, user);
  }
}