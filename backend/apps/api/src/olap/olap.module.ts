import { Module } from "@nestjs/common";
import { OlapService } from "./olap.service";
import { OlapController } from "./olap.controller";

@Module({
  controllers: [OlapController],
  providers: [OlapService],
})
export class OlapModule {}
