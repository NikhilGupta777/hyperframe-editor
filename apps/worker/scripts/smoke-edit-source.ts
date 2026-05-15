/**
 * Smoke test for the EDIT-SOURCE loop. Synthesises an MP4 with ffmpeg, hands it
 * to runEditSourceLoop, and asserts the pipeline runs to "done" with all 5
 * blocking gates green.
 *
 * Requires: ffmpeg in PATH. Does NOT require Vertex / Postgres / OCI / Redis.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execa } from "execa";

import { setEventTap, type JobEvent, type QueuedJob } from "@hyperframe-editor/queue";
import { runEditSourceLoop } from "../src/orchestrator/editSource.js";

const events: JobEvent[] = [];
setEventTap((_id, e) => {
  events.push(e);
});

const workDir = await mkdtemp(join(tmpdir(), "hf-edit-smoke-"));
const sourcePath = join(workDir, "input.mp4");
console.log(`workDir = ${workDir}`);

console.log("→ generating synthetic source video (8s, 720x1280)…");
await execa(
  "ffmpeg",
  [
    "-y",
    "-f",
    "lavfi",
    "-i",
    "color=c=0x113355:s=720x1280:d=8:r=30",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:sample_rate=16000:duration=8",
    "-vf",
    "drawtext=text='source video for edit-source smoke':fontcolor=white:fontsize=28:x=(w-text_w)/2:y=(h-text_h)/2",
    "-pix_fmt",
    "yuv420p",
    "-shortest",
    sourcePath,
  ],
  { reject: true },
);

const job: QueuedJob = {
  jobId: "edit-smoke",
  kind: "edit_source",
  projectId: "edit-smoke",
  payload: {
    sourceUri: sourcePath,
    presetId: "podcast-clip",
    direction: "Make a short highlight",
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
  await rm(workDir, { recursive: true, force: true });
}

const steps = events.filter((e) => e.type === "step").map((e) => (e as { step: string }).step);
const gateEvents = events.filter((e) => e.type === "gate") as Array<{
  type: "gate";
  id: string;
  pass: boolean;
  severity: "block" | "warn";
}>;
const done = events.find((e) => e.type === "done");

console.log("\nsteps:", steps.join(" → "));
for (const g of gateEvents) {
  const tag = g.pass ? "PASS" : g.severity === "warn" ? "WARN" : "FAIL";
  console.log(`  ${tag.padEnd(4)} ${g.id}`);
}

if (exitCode === 0) {
  // Per-source steps now carry the source id (e.g. PROBE:src-0). We check
  // that AT LEAST ONE step matches each expected stage prefix.
  const expectedPrefixes = [
    "PROBE",
    "EXTRACT_AUDIO",
    "TRANSCRIBE",
    "PACK_SOURCES",
    "PROPOSE_EDL",
    "CONCAT_CUTS",
    "COMPOSE_OVER_EDL",
    "LINT",
    "RENDER",
    "GATES",
  ];
  for (const prefix of expectedPrefixes) {
    if (!steps.some((s) => s === prefix || s.startsWith(prefix + ":"))) {
      console.error(`MISSING step: ${prefix}`);
      exitCode = 1;
    }
  }
  const failedBlocking = gateEvents.filter((g) => !g.pass && g.severity === "block");
  if (failedBlocking.length > 0) {
    console.error(`blocking gate failures: ${failedBlocking.map((g) => g.id).join(", ")}`);
    exitCode = 1;
  }
  if (!done) {
    console.error("missing done event");
    exitCode = 1;
  }
}

if (exitCode === 0) console.log("\nedit-source smoke OK.");
process.exit(exitCode);
