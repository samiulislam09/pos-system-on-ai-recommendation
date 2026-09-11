import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { UseGuards } from "@nestjs/common";
import {
  fixSupplierUploadSchema,
  paginationSchema,
  resubmitWithEditsSchema,
  supplierResubmitSchema,
  supplierUploadSchema,
} from "@inv/validation";
import type {
  FixSupplierUploadInput,
  ResubmitWithEditsInput,
  SupplierUploadInput,
} from "@inv/validation";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { Public } from "../common/decorators/auth.decorator";
import { CurrentSupplier, type SupplierAuthUser } from "./supplier-auth.decorator";
import { SupplierJwtAuthGuard } from "./supplier-jwt-auth.guard";
import { SupplierUploadsService } from "./supplier-uploads.service";
import { SupplierUploadStatus } from "@inv/database";

@Public()
@UseGuards(SupplierJwtAuthGuard)
@Controller("supplier-portal")
export class SupplierUploadsController {
  constructor(private readonly uploads: SupplierUploadsService) {}

  @Get("me")
  me(@CurrentSupplier() supplier: SupplierAuthUser) {
    return this.uploads.profile(supplier);
  }

  @Get("uploads")
  list(
    @CurrentSupplier() supplier: SupplierAuthUser,
    @Query(new ZodValidationPipe(paginationSchema)) query: { page: number; limit: number },
    @Query("status") status?: string,
  ) {
    return this.uploads.listMyUploads(
      supplier,
      query.page,
      query.limit,
      status ? (status as SupplierUploadStatus) : undefined,
    );
  }

  @Post("uploads")
  create(
    @CurrentSupplier() supplier: SupplierAuthUser,
    @Body(new ZodValidationPipe(supplierUploadSchema)) body: SupplierUploadInput,
  ) {
    return this.uploads.createUpload(supplier, body);
  }

  @Get("uploads/:id")
  get(@CurrentSupplier() supplier: SupplierAuthUser, @Param("id") id: string) {
    return this.uploads.getMyUpload(supplier, id);
  }

  @Get("uploads/:id/file")
  file(@CurrentSupplier() supplier: SupplierAuthUser, @Param("id") id: string) {
    return this.uploads.file(supplier, id);
  }

  @Post("uploads/:id/resubmit")
  resubmit(
    @CurrentSupplier() supplier: SupplierAuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(supplierResubmitSchema)) body: SupplierUploadInput,
  ) {
    return this.uploads.resubmit(supplier, id, body);
  }

  @Post("uploads/:id/resubmit-edits")
  resubmitEdits(
    @CurrentSupplier() supplier: SupplierAuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(resubmitWithEditsSchema)) body: ResubmitWithEditsInput,
  ) {
    return this.uploads.resubmitWithEdits(supplier, id, body);
  }

  @Post("uploads/:id/fix")
  fix(
    @CurrentSupplier() supplier: SupplierAuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(fixSupplierUploadSchema)) body: FixSupplierUploadInput,
  ) {
    return this.uploads.fixItems(supplier, id, body);
  }

  @Get("notifications")
  notifications(@CurrentSupplier() supplier: SupplierAuthUser) {
    return this.uploads.listNotifications(supplier);
  }

  @Post("notifications/:id/read")
  markRead(@CurrentSupplier() supplier: SupplierAuthUser, @Param("id") id: string) {
    return this.uploads.markNotificationRead(supplier, id);
  }
}