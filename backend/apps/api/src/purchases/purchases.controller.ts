import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
} from "@nestjs/common";
import {
  createPurchaseOrderSchema,
  createSupplierSchema,
  paginationSchema,
  receivePurchaseOrderSchema,
} from "@inv/validation";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { PurchasesService } from "./purchases.service";
import {
  CurrentUser,
  RequirePermission,
  type AuthUser,
} from "../common/decorators/auth.decorator";

@Controller("purchases")
export class PurchasesController {
  constructor(private readonly purchasesService: PurchasesService) {}

  @Get("suppliers")
  @RequirePermission("suppliers.manage", "purchases.create")
  suppliers(@CurrentUser() user: AuthUser) {
    return this.purchasesService.listSuppliers(user.organizationId!);
  }

  @Post("suppliers")
  @RequirePermission("suppliers.manage")
  createSupplier(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createSupplierSchema)) body: unknown,
  ) {
    return this.purchasesService.createSupplier(user.organizationId!, body as never, user);
  }

  @Get()
  @RequirePermission("purchases.create")
  list(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(paginationSchema)) query: { page: number; limit: number },
    @Query("status") status?: string,
  ) {
    return this.purchasesService.listPurchaseOrders(user.organizationId!, query.page, query.limit, status);
  }

  @Post()
  @RequirePermission("purchases.create")
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createPurchaseOrderSchema)) body: unknown,
  ) {
    return this.purchasesService.createPurchaseOrder(user.organizationId!, body as never, user);
  }

  @Get(":id")
  @RequirePermission("purchases.create")
  get(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    return this.purchasesService.getPurchaseOrder(user.organizationId!, id);
  }

  @Post(":id/receive")
  @RequirePermission("purchases.receive")
  receive(
    @Param("id") id: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(receivePurchaseOrderSchema)) body: unknown,
  ) {
    return this.purchasesService.receivePurchaseOrder(user.organizationId!, id, body as never, user);
  }
}