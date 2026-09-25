import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
} from "@nestjs/common";
import {
  acceptSupplierUploadSchema,
  createSupplierUserSchema,
  paginationSchema,
  rejectSupplierUploadSchema,
  returnIncompleteSchema,
  runSupplierUploadEtlSchema,
} from "@inv/validation";
import type {
  AcceptSupplierUploadInput,
  CreateSupplierUserInput,
  RejectSupplierUploadInput,
  ReturnIncompleteInput,
  RunSupplierUploadEtlInput,
} from "@inv/validation";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { SupplierPortalService } from "./supplier-portal.service";
import {
  CurrentUser,
  RequirePermission,
  type AuthUser,
} from "../common/decorators/auth.decorator";
import { SupplierUploadStatus } from "@inv/database";

@Controller("supplier-portal/manage")
export class SupplierPortalController {
  constructor(private readonly portal: SupplierPortalService) {}

  @Get("uploads")
  @RequirePermission("supplier-uploads.manage")
  list(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(paginationSchema)) query: { page: number; limit: number },
    @Query("status") status?: string,
    @Query("search") search?: string,
  ) {
    return this.portal.listUploads(
      user.organizationId!,
      query.page,
      query.limit,
      status ? (status as SupplierUploadStatus) : undefined,
      search,
    );
  }

  @Get("uploads/:id")
  @RequirePermission("supplier-uploads.manage")
  get(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    return this.portal.getUpload(user.organizationId!, id);
  }

  @Post("uploads/:id/accept")
  @RequirePermission("supplier-uploads.manage", "inventory.adjust")
  accept(
    @Param("id") id: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(acceptSupplierUploadSchema)) body: AcceptSupplierUploadInput,
  ) {
    return this.portal.acceptUpload(user.organizationId!, id, body, user);
  }

  @Post("uploads/:id/etl")
  @RequirePermission("supplier-uploads.manage")
  etl(
    @Param("id") id: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(runSupplierUploadEtlSchema)) body: RunSupplierUploadEtlInput,
  ) {
    return this.portal.runEtl(user.organizationId!, id, body, user);
  }

  @Post("uploads/:id/return-incomplete")
  @RequirePermission("supplier-uploads.manage")
  returnIncomplete(
    @Param("id") id: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(returnIncompleteSchema)) body: ReturnIncompleteInput,
  ) {
    return this.portal.returnIncomplete(user.organizationId!, id, body, user);
  }

  @Post("uploads/:id/reject")
  @RequirePermission("supplier-uploads.manage")
  reject(
    @Param("id") id: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(rejectSupplierUploadSchema)) body: RejectSupplierUploadInput,
  ) {
    return this.portal.rejectUpload(user.organizationId!, id, body, user);
  }

  @Get("suppliers")
  @RequirePermission("supplier-uploads.manage", "suppliers.manage", "inventory.read")
  listSuppliers(@CurrentUser() user: AuthUser) {
    return this.portal.listSupplierUsers(user.organizationId!);
  }

  @Post("suppliers")
  @RequirePermission("supplier-uploads.manage", "suppliers.manage")
  createSupplier(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createSupplierUserSchema)) body: CreateSupplierUserInput,
  ) {
    return this.portal.createSupplierUser(user.organizationId!, body, user);
  }
}