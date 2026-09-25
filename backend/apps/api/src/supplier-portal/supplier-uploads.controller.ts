import { Body, Controller, Get, Param, Post, Query, Sse, type MessageEvent } from "@nestjs/common";
import type { Observable } from "rxjs";
import { UseGuards } from "@nestjs/common";
import {
  paginationSchema,
  resubmitIncompleteItemsSchema,
  resubmitWithEditsSchema,
  supplierResubmitSchema,
  supplierUploadSchema,
} from "@inv/validation";
import type {
  ResubmitIncompleteItemsInput,
  ResubmitWithEditsInput,
  SupplierUploadInput,
} from "@inv/validation";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { Public } from "../common/decorators/auth.decorator";
import { CurrentSupplier, type SupplierAuthUser } from "./supplier-auth.decorator";
import { SupplierJwtAuthGuard } from "./supplier-jwt-auth.guard";
import { SupplierUploadsService } from "./supplier-uploads.service";
import { NotificationStream } from "./notification-stream.service";
import { SupplierUploadStatus } from "@inv/database";

@Public()
@UseGuards(SupplierJwtAuthGuard)
@Controller("supplier-portal")
export class SupplierUploadsController {
  constructor(
    private readonly uploads: SupplierUploadsService,
    private readonly notificationStream: NotificationStream,
  ) {}

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

  @Get("incomplete-items")
  incompleteItems(@CurrentSupplier() supplier: SupplierAuthUser) {
    return this.uploads.listIncompleteItems(supplier);
  }

  @Post("incomplete-items/resubmit")
  resubmitIncomplete(
    @CurrentSupplier() supplier: SupplierAuthUser,
    @Body(new ZodValidationPipe(resubmitIncompleteItemsSchema)) body: ResubmitIncompleteItemsInput,
  ) {
    return this.uploads.resubmitIncompleteItems(supplier, body);
  }

  @Get("notifications")
  notifications(@CurrentSupplier() supplier: SupplierAuthUser) {
    return this.uploads.listNotifications(supplier);
  }

  /** Live feed: an event whenever this supplier's notifications change. */
  @Sse("notifications/stream")
  notificationEvents(@CurrentSupplier() supplier: SupplierAuthUser): Observable<MessageEvent> {
    return this.notificationStream.stream("supplier", supplier.id);
  }

  @Post("notifications/:id/read")
  markRead(@CurrentSupplier() supplier: SupplierAuthUser, @Param("id") id: string) {
    return this.uploads.markNotificationRead(supplier, id);
  }
}