import { Module } from "@nestjs/common";
import { EventsService } from "./events.service";
import { EventsController } from "./events.controller";
import { InventoryEngine } from "../inventory/inventory-engine.service";
import { TenantService } from "../common/tenant.service";

@Module({
  controllers: [EventsController],
  providers: [EventsService, InventoryEngine, TenantService],
  exports: [EventsService],
})
export class EventsModule {}