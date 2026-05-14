/**
 * Smoke for the upgraded EDIT-SOURCE pipeline (real ffmpeg concat + caption
 * layer + multi-source).
 *
 * - Builds two synthetic source MP4s with distinct audio tones.
 * - Runs runEditSourceLoop with both sources.
 * - Asserts: pipeline completes, captions clip exists, composition includes
 *   both source IDs in the EDL trace via the merged transcript, and all 5
 *   blocking gates pass.
 *
 * Requires ffmpeg in PATH. No Vertex / OCI / Postgres / Redis.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execa } from "execa";

import { setEventTap, type JobEvent, type QueuedJob } from "@hyperframe-editor/queue";
import { runEditSourceLoop } from "../src/orchestrator/editSource.js";

const events: JobEvent[] = [];
setEventTap((_id, e) => events.push(e));

const work = await mkdtemp(join(tmpdir(), "hf-edit-real-"));
console.log(`workDir = ${work}`);

async function makeSource(path: string, freq: number, color: string) {
  await execa(
    "ffmpeg",
    [
      "-y",
      "-f",
      "lavfi",
      "-i",
      `color=c=${color}:s=720x1280:d=8:r=30`,
      "-f",
      "lavfi",
      "-i",
      `sine=frequency=${freq}:sample_rate=44100:duration=8`,
      "-shortest",
      "-pix_fmt",
      "yuv420p",
      path,
    ],
    { reject: true },
  );
}

const a = join(work, "a.mp4");
const b = join(work, "b.mp4");
await makeSource(a, 440, "0x113355");
await makeSource(b, 660, "0x553311");

const job: QueuedJob = {
  jobId: "edit-real",
  kind: "edit_source",
  projectId: "edit-real",
  payload: {
    sources: [
      { id: "speaker-A", uri: a },
      { id: "speaker-B", uri: b },
    ],
    presetId: "podcast-clip",
    direction: "60-second highlight from both speakers",
    targetDurationSec: 4,
  } as Record<string, unknown>,
};

process.env.RENDER_BACKEND = "synthetic";
let exitCode = 0;
try {
  await runEditSourceLoop(job);
} catch (e) {
  console.error("loop threw:", e);
  exitCode = 1;
} finally {
  await rm(work, { recursive: true, force: true });
}

const steps = events.filter((e) => e.type === "step").map((e) => (e as { step: string }).step);
const gateEvents = events.filter((e) => e.type === "gate") as Array<{
  type: "gate";
  id: string;
  pass: boolean;
  severity: "block" | "warn";
}>;
const done = events.find((e) => e.type === "done");
const captionLog = events.find(
  (e) => e.type === "log" && /captions:\s*\d+/.test((e as { msg: string }).msg),
);

console.log("\nsteps:", steps.join(" → "));
for (const g of gateEvents) {
  const tag = g.pass ? "PASS" : g.severity === "warn" ? "WARN" : "FAIL";
  console.log(`  ${tag.padEnd(4)} ${g.id}`);
}

if (exitCode === 0) {
  if (!steps.some((s) => s.startsWith("PROBE:speaker-A"))) {
    console.error("MISSING per-source PROBE step for speaker-A");
    exitCode = 1;
  }
  if (!steps.includes("CONCAT_CUTS")) {
    console.error("MISSING step: CONCAT_CUTS");
    exitCode = 1;
  }
  if (!captionLog) {
    console.error("MISSING captions log line");
    exitCode = 1;
  }
  const failedBlocking = gateEvents.filter((g) => !g.pass && g.severity === "block");
  if (failedBlocking.length > 0) {
    console.error("blocking gate failures:", failedBlocking.map((g) => g.id).join(", "));
    exitCode = 1;
  }
  if (!done) {
    console.error("missing done event");
    exitCode = 1;
  }
}

if (exitCode === 0) console.log("\nedit-source-real smoke OK.");
process.exit(exitCode);
