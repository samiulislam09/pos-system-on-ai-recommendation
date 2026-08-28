import { Module } from "@nestjs/common";
import { ReturnsService } from "./returns.service";
import { ReturnsController } from "./returns.controller";
import { InventoryEngine } from "../inventory/inventory-engine.service";

@Module({
  controllers: [ReturnsController],
  providers: [ReturnsService, InventoryEngine],
  exports: [ReturnsService],
})
export class ReturnsModule {}