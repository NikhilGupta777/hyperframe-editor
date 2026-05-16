/**
 * Smoke test for the cost tracker wiring. Runs the BUILD loop end-to-end with
 * the synthetic render backend and asserts:
 *
 *   1. At least one `tool` event with name='cost' arrives (render charge).
 *   2. A `costSummary` event is emitted at the end with totalUsd > 0.
 *   3. The summary's totalUsd matches the sum of the per-entry events
 *      (within float tolerance).
 *
 * No Vertex / Postgres / OCI / Redis required.
 */
import { setEventTap, type JobEvent, type QueuedJob } from "@hyperframe-editor/queue";
import { runComposeLoop } from "../src/orchestrator/compose.js";

const events: JobEvent[] = [];
setEventTap((_id, e) => events.push(e));

process.env.RENDER_BACKEND = "synthetic";
process.env.WORKER_OFFLINE_STUBS = "1";

const job: QueuedJob = {
  jobId: "cost-smoke-job",
  kind: "compose",
  projectId: "cost-smoke",
  payload: {
    prompt: "Make a 30-second TikTok-style hook reel about morning chai.",
    presetId: "tiktok-hook",
    freeOnly: true,
  } as Record<string, unknown>,
};

let exitCode = 0;
try {
  await runComposeLoop(job);
} catch (e) {
  console.error("loop threw:", e);
  exitCode = 1;
}

const costEntryEvents = events.filter(
  (e) => e.type === "tool" && (e as { name: string }).name === "cost",
) as Array<{ type: "tool"; name: "cost"; output: { costUsd: number; provider: string; unit: string } }>;
const summaryEvents = events.filter(
  (e) => e.type === "tool" && (e as { name: string }).name === "costSummary",
) as Array<{ type: "tool"; name: "costSummary"; output: { totalUsd: number } }>;
const done = events.find((e) => e.type === "done");

console.log(`captured ${costEntryEvents.length} cost entries`);
for (const e of costEntryEvents) {
  console.log(`  - ${e.output.provider} ${e.output.unit} = $${e.output.costUsd.toFixed(6)}`);
}

if (costEntryEvents.length === 0) {
  console.error("FAIL: no cost entries emitted (render charge should have fired)");
  exitCode = 1;
}

const summary = summaryEvents.at(-1);
if (!summary) {
  console.error("FAIL: no costSummary event at end of loop");
  exitCode = 1;
} else if (summary.output.totalUsd <= 0) {
  console.error(`FAIL: costSummary totalUsd should be > 0 (got ${summary.output.totalUsd})`);
  exitCode = 1;
} else {
  const sum = costEntryEvents.reduce((a, e) => a + e.output.costUsd, 0);
  if (Math.abs(sum - summary.output.totalUsd) > 1e-5) {
    console.error(
      `FAIL: summary total ${summary.output.totalUsd} != sum of entries ${sum.toFixed(6)}`,
    );
    exitCode = 1;
  } else {
    console.log(`PASS  costSummary totalUsd = $${summary.output.totalUsd.toFixed(6)}`);
  }
}

if (!done) {
  console.error("FAIL: missing done event");
  exitCode = 1;
}

if (exitCode === 0) console.log("\ncost smoke OK.");
process.exit(exitCode);
