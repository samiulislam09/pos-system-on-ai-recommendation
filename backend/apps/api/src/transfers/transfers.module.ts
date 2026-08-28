import { Module } from "@nestjs/common";
import { TransfersService } from "./transfers.service";
import { TransfersController } from "./transfers.controller";
import { InventoryEngine } from "../inventory/inventory-engine.service";

@Module({
  controllers: [TransfersController],
  providers: [TransfersService, InventoryEngine],
  exports: [TransfersService],
})
export class TransfersModule {}