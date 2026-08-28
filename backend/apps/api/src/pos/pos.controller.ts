import { Controller, Get, Query } from "@nestjs/common";
import { posProductsQuerySchema, type PosProductsQueryInput } from "@inv/validation";
import { CurrentUser, RequirePermission, type AuthUser } from "../common/decorators/auth.decorator";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { PosService } from "./pos.service";

@Controller("pos")
@RequirePermission("sales.create")
export class PosController {
  constructor(private readonly posService: PosService) {}

  @Get("bootstrap")
  bootstrap(@CurrentUser() user: AuthUser) {
    return this.posService.bootstrap(user.organizationId!);
  }

  @Get("products")
  products(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(posProductsQuerySchema)) query: PosProductsQueryInput,
  ) {
    return this.posService.products(user.organizationId!, query);
  }
}
