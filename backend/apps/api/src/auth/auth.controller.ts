import { Body, Controller, HttpCode, Post, Req } from "@nestjs/common";
import {
  LoginInput,
  RegisterOrganizationInput,
  loginSchema,
  refreshTokenSchema,
  registerOrganizationSchema,
} from "@inv/validation";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { AuthService } from "./auth.service";
import { Public, CurrentUser, type AuthUser } from "../common/decorators/auth.decorator";

@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post("login")
  @HttpCode(200)
  login(
    @Body(new ZodValidationPipe(loginSchema)) body: LoginInput,
    @Req() req: Record<string, any>,
  ) {
    return this.authService.login(body, {
      ip: req.ip,
      userAgent: req.headers["user-agent"],
    });
  }

  @Public()
  @Post("register-organization")
  @HttpCode(201)
  register(@Body(new ZodValidationPipe(registerOrganizationSchema)) body: RegisterOrganizationInput) {
    return this.authService.registerOrganization(body);
  }

  @Public()
  @Post("refresh")
  @HttpCode(200)
  refresh(
    @Body(new ZodValidationPipe(refreshTokenSchema)) body: { refreshToken: string },
    @Req() req: Record<string, any>,
  ) {
    return this.authService.refresh(body.refreshToken, {
      ip: req.ip,
      userAgent: req.headers["user-agent"],
    });
  }

  @Post("logout")
  @HttpCode(200)
  logout(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(refreshTokenSchema)) body: { refreshToken: string },
  ) {
    return this.authService.logout(user, body.refreshToken);
  }
}