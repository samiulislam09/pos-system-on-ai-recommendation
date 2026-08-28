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
  createLocationSchema,
  createPostTerminalSchema,
  updateLocationSchema,
  updatePostTerminalSchema,
} from "@inv/validation";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { StoresService } from "./stores.service";
import {
  CurrentUser,
  RequirePermission,
  type AuthUser,
} from "../common/decorators/auth.decorator";
import { LocationType } from "@inv/database";

@Controller("stores")
export class StoresController {
  constructor(private readonly storesService: StoresService) {}

  @Get()
  @RequirePermission("stores.manage", "inventory.read")
  list(
    @CurrentUser() user: AuthUser,
    @Query("type") type?: LocationType,
  ) {
    return this.storesService.list(user.organizationId!, type);
  }

  @Post()
  @RequirePermission("stores.manage")
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createLocationSchema)) body: unknown,
  ) {
    return this.storesService.create(user.organizationId!, body as never, user);
  }

  @Get(":id")
  @RequirePermission("stores.manage", "inventory.read")
  get(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    return this.storesService.get(user.organizationId!, id);
  }

  @Patch(":id")
  @RequirePermission("stores.manage")
  update(
    @Param("id") id: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(updateLocationSchema)) body: unknown,
  ) {
    return this.storesService.update(user.organizationId!, id, body as never, user);
  }

  @Get(":storeId/terminals")
  @RequirePermission("stores.manage")
  listTerminals(@Param("storeId") storeId: string, @CurrentUser() user: AuthUser) {
    return this.storesService.listTerminals(user.organizationId!, storeId);
  }

  @Post(":storeId/terminals")
  @RequirePermission("stores.manage")
  createTerminal(
    @Param("storeId") storeId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createPostTerminalSchema)) body: unknown,
  ) {
    const input = body as { storeId: string; terminalCode: string };
    return this.storesService.createTerminal(user.organizationId!, { storeId, terminalCode: input.terminalCode }, user);
  }

  @Patch(":storeId/terminals/:terminalId")
  @RequirePermission("stores.manage")
  updateTerminal(
    @Param("terminalId") terminalId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(updatePostTerminalSchema)) body: unknown,
  ) {
    return this.storesService.updateTerminal(user.organizationId!, terminalId, body as never, user);
  }
}