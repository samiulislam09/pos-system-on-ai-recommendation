import { Controller, Get } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { Public } from "../common/decorators/auth.decorator";

@Controller("health")
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get()
  async health() {
    let db = "ok";
    let redis = "unavailable";
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      db = "down";
    }
    try {
      const { default: Redis } = await import("ioredis");
      const client = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
        lazyConnect: true,
        maxRetriesPerRequest: 1,
        connectTimeout: 1500,
      });
      await client.connect();
      await client.ping();
      redis = "ok";
      client.disconnect();
    } catch {
      redis = "down";
    }
    return { status: db === "ok" ? "ok" : "degraded", db, redis, timestamp: new Date().toISOString() };
  }
}