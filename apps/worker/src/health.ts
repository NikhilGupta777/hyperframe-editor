/**
 * Minimal HTTP health-check server for the worker process.
 *
 * Exposes a single endpoint at :PORT/health (default port 8787) so:
 *   - Docker's HEALTHCHECK can verify the process is alive
 *   - systemd's ExecStartPre/watchdog can probe it
 *   - OCI Load Balancer (if we add one later) can route traffic
 *
 * The check goes beyond "process alive" — it verifies:
 *   - Redis is connected (PING)
 *   - Postgres is reachable (SELECT 1)
 *   - Worker loop is running (hasn't crashed)
 *
 * Startup:
 *   import { startHealthServer } from "./health.js";
 *   startHealthServer();
 */
import { createServer } from "node:http";

interface HealthDeps {
  /** Returns true if the consumer loop is actively polling. */
  isLoopAlive: () => boolean;
}

let deps: HealthDeps = { isLoopAlive: () => true };

export function setHealthDeps(d: HealthDeps): void {
  deps = d;
}

export function startHealthServer(port = Number(process.env.HEALTH_PORT ?? "8787")): void {
  const server = createServer(async (req, res) => {
    if (req.url !== "/health" && req.url !== "/healthz") {
      res.writeHead(404);
      res.end("not found");
      return;
    }

    const checks: Record<string, "ok" | "fail"> = {};
    let healthy = true;

    // Check 1: Worker loop alive
    checks.loop = deps.isLoopAlive() ? "ok" : "fail";
    if (checks.loop === "fail") healthy = false;

    // Check 2: Redis PING
    try {
      if (process.env.REDIS_URL) {
        const { getRedis } = await import("@hyperframe-editor/queue");
        const pong = await getRedis().ping();
        checks.redis = pong === "PONG" ? "ok" : "fail";
      } else {
        checks.redis = "ok"; // No Redis configured = offline mode
      }
    } catch {
      checks.redis = "fail";
      healthy = false;
    }

    // Check 3: Postgres SELECT 1
    try {
      if (process.env.DATABASE_URL) {
        const { getDb } = await import("@hyperframe-editor/db");
        const { sql } = await import("drizzle-orm");
        await getDb().execute(sql`SELECT 1`);
        checks.postgres = "ok";
      } else {
        checks.postgres = "ok"; // No DB = offline mode
      }
    } catch {
      checks.postgres = "fail";
      healthy = false;
    }

    const status = healthy ? 200 : 503;
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify({ status: healthy ? "healthy" : "unhealthy", checks }));
  });

  server.listen(port, () => {
    console.log(`[worker] health server listening on :${port}/health`);
  });
}
