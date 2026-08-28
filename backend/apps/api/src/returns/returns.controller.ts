import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
} from "@nestjs/common";
import { approveReturnSchema, paginationSchema } from "@inv/validation";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { ReturnsService } from "./returns.service";
import {
  CurrentUser,
  RequirePermission,
  type AuthUser,
} from "../common/decorators/auth.decorator";

@Controller("returns")
export class ReturnsController {
  constructor(private readonly returnsService: ReturnsService) {}

  @Get()
  @RequirePermission("returns.create", "sales.read")
  list(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(paginationSchema)) query: { page: number; limit: number },
    @Query("storeId") storeId?: string,
  ) {
    return this.returnsService.list(user.organizationId!, query.page, query.limit, storeId);
  }

  @Get(":id")
  @RequirePermission("returns.create", "sales.read")
  get(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    return this.returnsService.get(user.organizationId!, id);
  }

  @Post(":id/approve")
  @RequirePermission("returns.approve")
  approve(
    @Param("id") id: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(approveReturnSchema)) body: unknown,
  ) {
    return this.returnsService.approve(user.organizationId!, id, body as never, user);
  }

  @Post(":id/reject")
  @RequirePermission("returns.approve")
  reject(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    return this.returnsService.reject(user.organizationId!, id, user);
  }
}