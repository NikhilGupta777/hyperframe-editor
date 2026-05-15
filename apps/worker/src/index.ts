/**
 * Worker entry. Long-running Node process that pulls jobs off Redis and runs
 * the agent state machine.
 *
 * Boot sequence:
 *   1. PLACEHOLDER mode (Dockerfile smoke check) — print + exit.
 *   2. Real mode:
 *      a. Apply DB migrations idempotently via `ensureMigrated`. Earlier
 *         operations docs told the operator to SSH in and run psql; that
 *         meant a fresh deploy 404'd until somebody remembered. Now the
 *         worker self-heals on start.
 *      b. Start the consumer loop.
 *
 * Boot is a hard fail when DATABASE_URL is set but unreachable: better a
 * loud crash than silent fakery against a missing schema.
 */
import process from "node:process";
import { runConsumerLoop } from "./orchestrator/loop.js";

if (process.env.PLACEHOLDER === "1") {
  console.log("[worker] placeholder boot. Set PLACEHOLDER=0 to consume jobs.");
  process.exit(0);
}

const consumerName = process.env.WORKER_NAME ?? `worker-${process.pid}`;
console.log(`[worker] starting ${consumerName}`);

// ---- Apply DB migrations on first boot ----------------------------------
// We call this BEFORE the consumer loop so we never accept a job whose
// orchestrator would query a not-yet-migrated table. Skip when DATABASE_URL
// is unset (smoke / dev without infra) so the worker still runs.
if (process.env.DATABASE_URL && process.env.WORKER_SKIP_MIGRATIONS !== "1") {
  try {
    const { ensureMigrated } = await import("@hyperframe-editor/db");
    const r = await ensureMigrated();
    console.log(
      `[worker] db.ensureMigrated strategy=${r.strategy} applied=[${r.applied.join(
        ",",
      )}] alreadyApplied=[${r.alreadyApplied.join(",")}]`,
    );
  } catch (e) {
    console.error(`[worker] db migrations failed; refusing to start: ${(e as Error).message}`);
    process.exit(1);
  }
}

const stop = await runConsumerLoop(consumerName);

const shutdown = async (sig: string) => {
  console.log(`[worker] received ${sig}; draining…`);
  await stop();
  process.exit(0);
};
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
