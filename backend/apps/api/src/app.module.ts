import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core";
import { PrismaModule } from "./prisma/prisma.module";
import { AuditModule } from "./audit/audit.module";
import { AuthModule } from "./auth/auth.module";
import { OrganizationsModule } from "./organizations/organizations.module";
import { UsersModule } from "./users/users.module";
import { StoresModule } from "./stores/stores.module";
import { ProductsModule } from "./products/products.module";
import { InventoryModule } from "./inventory/inventory.module";
import { EventsModule } from "./events/events.module";
import { SalesModule } from "./sales/sales.module";
import { ReturnsModule } from "./returns/returns.module";
import { PurchasesModule } from "./purchases/purchases.module";
import { TransfersModule } from "./transfers/transfers.module";
import { TransactionsModule } from "./transactions/transactions.module";
import { ReportsModule } from "./reports/reports.module";
import { HealthModule } from "./health/health.module";
import { QueueModule } from "./queue/queue.module";
import { PosModule } from "./pos/pos.module";
import { AiModule } from "./ai/ai.module";
import { GlobalExceptionFilter } from "./common/filters/global-exception.filter";
import { ResponseInterceptor } from "./common/interceptors/response.interceptor";
import { LoggingInterceptor } from "./common/interceptors/logging.interceptor";
import { JwtAuthGuard } from "./common/guards/jwt-auth.guard";
import { PermissionsGuard } from "./common/guards/permissions.guard";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [".env", "../../.env"],
    }),
    PrismaModule,
    AuditModule,
    AuthModule,
    OrganizationsModule,
    UsersModule,
    StoresModule,
    ProductsModule,
    InventoryModule,
    EventsModule,
    SalesModule,
    ReturnsModule,
    PurchasesModule,
    TransfersModule,
    TransactionsModule,
    ReportsModule,
    HealthModule,
    QueueModule,
    PosModule,
    AiModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
    { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule {}
