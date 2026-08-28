import { Module } from "@nestjs/common";
import { PosController } from "./pos.controller";
import { PosService } from "./pos.service";
import { TenantService } from "../common/tenant.service";

@Module({
  controllers: [PosController],
  providers: [PosService, TenantService],
})
export class PosModule {}
