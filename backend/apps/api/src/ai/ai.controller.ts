import { Controller, Get, Post } from "@nestjs/common";
import { AiService } from "./ai.service";
import {
  CurrentUser,
  RequirePermission,
  type AuthUser,
} from "../common/decorators/auth.decorator";

@Controller("ai")
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Get("recommendations")
  @RequirePermission("reports.read")
  recommendations(@CurrentUser() user: AuthUser) {
    return this.aiService.recommendations(user.organizationId!);
  }

  @Post("run")
  @RequirePermission("reports.read")
  run() {
    return this.aiService.runPipeline();
  }

  @Get("run/status")
  @RequirePermission("reports.read")
  runStatus() {
    return this.aiService.runStatus();
  }
}
