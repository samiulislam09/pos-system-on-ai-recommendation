import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
} from "@nestjs/common";
import {
  createTransferSchema,
  paginationSchema,
  receiveTransferSchema,
} from "@inv/validation";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { TransfersService } from "./transfers.service";
import {
  CurrentUser,
  RequirePermission,
  type AuthUser,
} from "../common/decorators/auth.decorator";

@Controller("transfers")
export class TransfersController {
  constructor(private readonly transfersService: TransfersService) {}

  @Get()
  @RequirePermission("transfers.create")
  list(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(paginationSchema)) query: { page: number; limit: number },
    @Query("status") status?: string,
  ) {
    return this.transfersService.list(user.organizationId!, query.page, query.limit, status);
  }

  @Post()
  @RequirePermission("transfers.create")
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createTransferSchema)) body: unknown,
  ) {
    return this.transfersService.create(user.organizationId!, body as never, user);
  }

  @Get(":id")
  @RequirePermission("transfers.create")
  get(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    return this.transfersService.get(user.organizationId!, id);
  }

  @Post(":id/approve")
  @RequirePermission("transfers.approve")
  approve(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    return this.transfersService.approve(user.organizationId!, id, user);
  }

  @Post(":id/ship")
  @RequirePermission("transfers.ship")
  ship(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    return this.transfersService.ship(user.organizationId!, id, user);
  }

  @Post(":id/receive")
  @RequirePermission("transfers.receive")
  receive(
    @Param("id") id: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(receiveTransferSchema)) body: unknown,
  ) {
    return this.transfersService.receive(user.organizationId!, id, body as never, user);
  }

  @Post(":id/cancel")
  @RequirePermission("transfers.approve")
  cancel(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    return this.transfersService.cancel(user.organizationId!, id, user);
  }
}