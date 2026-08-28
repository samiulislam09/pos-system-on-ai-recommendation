import { Module } from "@nestjs/common";
import { PurchasesService } from "./purchases.service";
import { PurchasesController } from "./purchases.controller";
import { InventoryEngine } from "../inventory/inventory-engine.service";

@Module({
  controllers: [PurchasesController],
  providers: [PurchasesService, InventoryEngine],
  exports: [PurchasesService],
})
export class PurchasesModule {}