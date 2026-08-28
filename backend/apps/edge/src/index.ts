import { EdgeDb } from "./db";
import { EdgeServer } from "./server";
import { SyncEngine } from "./sync";

interface Env {
  EDGE_DB_PATH: string;
  EDGE_API_URL: string;
  EDGE_TERMINAL_TOKEN: string;
  EDGE_SYNC_INTERVAL_MS: number;
  EDGE_MAX_RETRY_DELAY_MS: number;
  EDGE_PORT: number;
  EDGE_BATCH_SIZE: number;
}

function loadEnv(): Env {
  return {
    EDGE_DB_PATH: process.env.EDGE_DB_PATH ?? "./data/edge.sqlite",
    EDGE_API_URL: process.env.EDGE_API_URL ?? "http://localhost:4000/api/v1",
    EDGE_TERMINAL_TOKEN: process.env.EDGE_TERMINAL_TOKEN ?? "",
    EDGE_SYNC_INTERVAL_MS: parseInt(process.env.EDGE_SYNC_INTERVAL_MS ?? "15000", 10),
    EDGE_MAX_RETRY_DELAY_MS: parseInt(process.env.EDGE_MAX_RETRY_DELAY_MS ?? "60000", 10),
    EDGE_PORT: parseInt(process.env.EDGE_PORT ?? "5100", 10),
    EDGE_BATCH_SIZE: parseInt(process.env.EDGE_BATCH_SIZE ?? "50", 10),
  };
}

async function main() {
  const env = loadEnv();
  const db = new EdgeDb(env.EDGE_DB_PATH);
  const server = new EdgeServer(db, env.EDGE_PORT);
  const sync = new SyncEngine(db, {
    apiUrl: env.EDGE_API_URL,
    token: env.EDGE_TERMINAL_TOKEN,
    batchSize: env.EDGE_BATCH_SIZE,
    maxRetryDelayMs: env.EDGE_MAX_RETRY_DELAY_MS,
  });

  server.start();

  const runLoop = async () => {
    try {
      const result = await sync.syncOnce();
      if (result.synced > 0 || result.failed > 0) {
        console.log(`[edge] sync: ${JSON.stringify(result)}`);
      }
    } catch (error) {
      console.error("[edge] sync error:", error);
    }
  };

  // Sync immediately on startup, then on interval.
  await runLoop();
  const interval = setInterval(runLoop, env.EDGE_SYNC_INTERVAL_MS);

  const shutdown = () => {
    clearInterval(interval);
    db.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});