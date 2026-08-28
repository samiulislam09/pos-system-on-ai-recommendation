import { Module } from "@nestjs/common";
import { InventoryService } from "./inventory.service";
import { InventoryEngine } from "./inventory-engine.service";
import { InventoryController } from "./inventory.controller";

@Module({
  controllers: [InventoryController],
  providers: [InventoryService, InventoryEngine],
  exports: [InventoryService, InventoryEngine],
})
export class InventoryModule {}