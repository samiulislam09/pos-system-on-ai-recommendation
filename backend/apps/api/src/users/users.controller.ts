import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import { createUserSchema, paginationSchema, updateUserSchema } from "@inv/validation";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { UsersService } from "./users.service";
import {
  CurrentUser,
  RequirePermission,
  type AuthUser,
} from "../common/decorators/auth.decorator";

@Controller("users")
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @RequirePermission("users.manage")
  list(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(paginationSchema)) query: { page: number; limit: number },
  ) {
    if (!user.organizationId) throw new Error("No organization");
    return this.usersService.list(user.organizationId, query.page, query.limit);
  }

  @Post()
  @RequirePermission("users.manage")
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createUserSchema)) body: unknown,
  ) {
    if (!user.organizationId) throw new Error("No organization");
    return this.usersService.create(user.organizationId, body as never, user);
  }

  @Patch(":id")
  @RequirePermission("users.manage")
  update(
    @Param("id") id: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(updateUserSchema)) body: unknown,
  ) {
    if (!user.organizationId) throw new Error("No organization");
    return this.usersService.update(user.organizationId, id, body as never, user);
  }
}