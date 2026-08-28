import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import {
  createBrandSchema,
  createCategorySchema,
  createProductSchema,
  paginationSchema,
  updateProductSchema,
} from "@inv/validation";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { ProductsService } from "./products.service";
import {
  CurrentUser,
  RequirePermission,
  type AuthUser,
} from "../common/decorators/auth.decorator";

@Controller("products")
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Get()
  @RequirePermission("products.read")
  list(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(paginationSchema)) query: { page: number; limit: number },
    @Query("categoryId") categoryId?: string,
    @Query("brandId") brandId?: string,
    @Query("search") search?: string,
    @Query("status") status?: string,
  ) {
    return this.productsService.list(user.organizationId!, query.page, query.limit, {
      categoryId,
      brandId,
      search,
      status,
    });
  }

  @Post()
  @RequirePermission("products.create")
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createProductSchema)) body: unknown,
  ) {
    return this.productsService.create(user.organizationId!, body as never, user);
  }

  @Get("categories")
  @RequirePermission("products.read")
  categories(@CurrentUser() user: AuthUser) {
    return this.productsService.listCategories(user.organizationId!);
  }

  @Post("categories")
  @RequirePermission("products.create")
  createCategory(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createCategorySchema)) body: { name: string; parentId?: string },
  ) {
    return this.productsService.createCategory(user.organizationId!, body.name, body.parentId, user);
  }

  @Get("brands")
  @RequirePermission("products.read")
  brands(@CurrentUser() user: AuthUser) {
    return this.productsService.listBrands(user.organizationId!);
  }

  @Post("brands")
  @RequirePermission("products.create")
  createBrand(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createBrandSchema)) body: { name: string },
  ) {
    return this.productsService.createBrand(user.organizationId!, body.name, user);
  }

  @Get(":id")
  @RequirePermission("products.read")
  get(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    return this.productsService.get(user.organizationId!, id);
  }

  @Patch(":id")
  @RequirePermission("products.update")
  update(
    @Param("id") id: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(updateProductSchema)) body: unknown,
  ) {
    return this.productsService.update(user.organizationId!, id, body as never, user);
  }
}