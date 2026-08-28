import { Global, Module } from "@nestjs/common";
import { PrismaService } from "./prisma.service";
import { TenantService } from "../common/tenant.service";

@Global()
@Module({
  providers: [PrismaService, TenantService],
  exports: [PrismaService, TenantService],
})
export class PrismaModule {}