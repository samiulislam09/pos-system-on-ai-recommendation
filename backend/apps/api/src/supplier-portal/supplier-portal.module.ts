import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { JwtModule } from "@nestjs/jwt";
import { PassportModule } from "@nestjs/passport";
import { AuditModule } from "../audit/audit.module";
import { AiModule } from "../ai/ai.module";
import { InventoryEngine } from "../inventory/inventory-engine.service";
import { SupplierAuthService } from "./supplier-auth.service";
import { SupplierAuthController } from "./supplier-auth.controller";
import { SupplierJwtStrategy } from "./supplier-jwt.strategy";
import { SupplierPortalService } from "./supplier-portal.service";
import { SupplierPortalController } from "./supplier-portal.controller";
import { SupplierUploadsService } from "./supplier-uploads.service";
import { SupplierUploadsController } from "./supplier-uploads.controller";
import { NotificationStream } from "./notification-stream.service";
import { VendorNotificationsService } from "./vendor-notifications.service";
import { VendorNotificationsController } from "./vendor-notifications.controller";

@Module({
  imports: [ConfigModule, AuditModule, AiModule, PassportModule, JwtModule.register({})],
  controllers: [
    SupplierAuthController,
    SupplierPortalController,
    SupplierUploadsController,
    VendorNotificationsController,
  ],
  providers: [
    SupplierAuthService,
    SupplierJwtStrategy,
    SupplierPortalService,
    SupplierUploadsService,
    NotificationStream,
    VendorNotificationsService,
    InventoryEngine,
  ],
  exports: [SupplierAuthService],
})
export class SupplierPortalModule {}