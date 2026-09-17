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

@Module({
  imports: [ConfigModule, AuditModule, AiModule, PassportModule, JwtModule.register({})],
  controllers: [
    SupplierAuthController,
    SupplierPortalController,
    SupplierUploadsController,
  ],
  providers: [
    SupplierAuthService,
    SupplierJwtStrategy,
    SupplierPortalService,
    SupplierUploadsService,
    InventoryEngine,
  ],
  exports: [SupplierAuthService],
})
export class SupplierPortalModule {}