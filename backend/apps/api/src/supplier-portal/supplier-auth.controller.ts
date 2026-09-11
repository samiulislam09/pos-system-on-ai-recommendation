import { Body, Controller, HttpCode, Post } from "@nestjs/common";
import { UseGuards } from "@nestjs/common";
import {
  refreshTokenSchema,
  supplierLoginSchema,
} from "@inv/validation";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { Public } from "../common/decorators/auth.decorator";
import { CurrentSupplier, type SupplierAuthUser } from "./supplier-auth.decorator";
import { SupplierJwtAuthGuard } from "./supplier-jwt-auth.guard";
import { SupplierAuthService } from "./supplier-auth.service";

@Controller("auth")
export class SupplierAuthController {
  constructor(private readonly supplierAuth: SupplierAuthService) {}

  @Public()
  @Post("supplier-login")
  @HttpCode(200)
  login(@Body(new ZodValidationPipe(supplierLoginSchema)) body: unknown) {
    return this.supplierAuth.login(body as { email: string; password: string });
  }

  @Public()
  @Post("supplier-refresh")
  @HttpCode(200)
  refresh(@Body(new ZodValidationPipe(refreshTokenSchema)) body: { refreshToken: string }) {
    return this.supplierAuth.refresh(body.refreshToken);
  }

  @UseGuards(SupplierJwtAuthGuard)
  @Post("supplier-logout")
  @HttpCode(200)
  logout(
    @CurrentSupplier() supplier: SupplierAuthUser,
    @Body(new ZodValidationPipe(refreshTokenSchema)) body: { refreshToken: string },
  ) {
    return this.supplierAuth.logout(supplier, body.refreshToken);
  }
}