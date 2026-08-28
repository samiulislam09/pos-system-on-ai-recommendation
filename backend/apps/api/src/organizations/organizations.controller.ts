import { Body, Controller, Get, Param, Patch, Post } from "@nestjs/common";
import { createOrganizationSchema, updateOrganizationSchema } from "@inv/validation";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { OrganizationsService } from "./organizations.service";
import {
  CurrentUser,
  RequirePermission,
  type AuthUser,
} from "../common/decorators/auth.decorator";

@Controller("organizations")
export class OrganizationsController {
  constructor(private readonly organizationsService: OrganizationsService) {}

  @Get()
  @RequirePermission("users.manage")
  list() {
    return this.organizationsService.list();
  }

  @Post()
  @RequirePermission("settings.manage")
  create(
    @Body(new ZodValidationPipe(createOrganizationSchema)) body: unknown,
    @CurrentUser() user: AuthUser,
  ) {
    return this.organizationsService.create(body as never, user);
  }

  @Get(":id")
  @RequirePermission("users.manage")
  get(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    return this.organizationsService.get(id, user);
  }

  @Patch(":id")
  @RequirePermission("settings.manage")
  update(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateOrganizationSchema)) body: unknown,
    @CurrentUser() user: AuthUser,
  ) {
    return this.organizationsService.update(id, body as never, user);
  }
}