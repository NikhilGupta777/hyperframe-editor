/**
 * Worker entry. Long-running Node process that pulls jobs off Redis and runs
 * the agent state machine.
 *
 * - Day 3 wires the queue consumer (this file).
 * - Day 5 wires the orchestrator's compose/edit/tweak loops (orchestrator.ts).
 *
 * Boots in two modes:
 *   PLACEHOLDER=1 — print a banner and exit (used for the Dockerfile smoke check)
 *   default       — start the consumer loop
 */
import process from "node:process";
import { runConsumerLoop } from "./orchestrator/loop.js";

if (process.env.PLACEHOLDER === "1") {
  console.log("[worker] placeholder boot. Set PLACEHOLDER=0 to consume jobs.");
  process.exit(0);
}

const consumerName = process.env.WORKER_NAME ?? `worker-${process.pid}`;
console.log(`[worker] starting ${consumerName}`);

const stop = await runConsumerLoop(consumerName);

const shutdown = async (sig: string) => {
  console.log(`[worker] received ${sig}; draining…`);
  await stop();
  process.exit(0);
};
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
