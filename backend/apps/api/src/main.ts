import { NestFactory } from "@nestjs/core";
import { ConfigService } from "@nestjs/config";
import helmet from "helmet";
import compression from "compression";
import rateLimit from "express-rate-limit";
import { AppModule } from "./app.module";
import { Logger } from "@nestjs/common";

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const config = app.get(ConfigService);
  const logger = new Logger("Bootstrap");

  app.use(helmet());
  app.use(compression());

  app.enableCors({
    origin: (config.get<string>("CORS_ORIGIN") ?? "http://localhost:3000")
      .split(",")
      .map((s) => s.trim()),
    credentials: true,
  });

  app.setGlobalPrefix("api/v1");

  app.use(
    "/api/v1",
    rateLimit({
      windowMs: 60 * 1000,
      limit: 600,
      standardHeaders: "draft-7",
      legacyHeaders: false,
      message: {
        success: false,
        error: { code: "RATE_LIMITED", message: "Too many requests" },
      },
    }),
  );

  const port = parseInt(config.get<string>("API_PORT") ?? "4000", 10);
  const host = config.get<string>("API_HOST") ?? "0.0.0.0";

  await app.listen(port, host);
  logger.log(`API listening on http://${host}:${port}/api/v1`);
}

bootstrap().catch((err) => {
  console.error(err);
  process.exit(1);
});