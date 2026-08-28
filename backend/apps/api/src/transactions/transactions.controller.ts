import { Controller, Get, Param, Query } from "@nestjs/common";
import { paginationSchema } from "@inv/validation";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { z } from "zod";
import { TransactionsService } from "./transactions.service";
import {
  CurrentUser,
  RequirePermission,
  type AuthUser,
} from "../common/decorators/auth.decorator";

const transactionQuerySchema = paginationSchema.extend({
  type: z.enum(["SALE", "RETURN"]).optional(),
  status: z.enum(["RECEIVED", "PROCESSED", "FAILED"]).optional(),
});

type TransactionQuery = z.infer<typeof transactionQuerySchema>;

@Controller("transactions")
export class TransactionsController {
  constructor(private readonly transactionsService: TransactionsService) {}

  @Get()
  @RequirePermission("sales.read")
  list(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(transactionQuerySchema)) query: TransactionQuery,
  ) {
    return this.transactionsService.list(user.organizationId!, query);
  }

  @Get(":id")
  @RequirePermission("sales.read")
  get(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    return this.transactionsService.get(user.organizationId!, id);
  }
}
