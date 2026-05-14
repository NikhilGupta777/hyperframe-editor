/**
 * Smoke test for the full gate pipeline.
 *
 * Builds a composition, "renders" it through the synthetic backend (ffmpeg color
 * source), then runs all 8 gates and asserts the expected pass/fail pattern.
 *
 * Requires: ffmpeg in PATH. Does NOT require Chromium / Vertex / OCI / Postgres.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  type Composition,
  TIKTOK_HOOK,
  computeDuration,
  type GateReport,
} from "@hyperframe-editor/core";
import { buildCompositionHtml } from "@hyperframe-editor/compose";

import { runRender } from "../src/render/runRender.js";
import { runGates } from "../src/gates/runner.js";

const composition: Composition = {
  id: "smoke-gates",
  canvas: TIKTOK_HOOK.canvas,
  duration: 4,
  assets: [],
  variables: {},
  clips: [
    {
      id: "hook-1",
      kind: "block",
      block: "HookTitle",
      trackIndex: 0,
      start: 0,
      duration: 2,
      playbackOffset: 0,
      props: { text: "Hello from the smoke", subtext: "8 gates ahead" },
    },
    {
      id: "cta-1",
      kind: "block",
      block: "EndCard",
      trackIndex: 0,
      start: 2,
      duration: 2,
      playbackOffset: 0,
      props: { cta: "Subscribe", handle: "@hf" },
    },
  ],
};
composition.duration = computeDuration(composition);

const workDir = await mkdtemp(join(tmpdir(), "hf-smoke-"));
console.log(`workDir = ${workDir}`);

let report: GateReport;
try {
  console.log("→ rendering (synthetic backend)…");
  process.env.RENDER_BACKEND = "synthetic";
  const r = await runRender({
    projectId: composition.id,
    composition,
    preset: TIKTOK_HOOK,
    workDir,
    onProgress: (pct) => process.stdout.write(`  progress: ${pct}%\r`),
  });
  console.log(`\n  mp4 → ${r.mp4Path}`);
  console.log(`  html → ${r.htmlPath}`);

  // We also write the html alongside in case the renderer didn't (it does, but
  // smoke tests are paranoid).
  const html = buildCompositionHtml({ preset: TIKTOK_HOOK, composition });
  await writeFile(r.htmlPath, html, "utf8");

  console.log("→ running gates…");
  report = await runGates({
    projectId: composition.id,
    composition,
    preset: TIKTOK_HOOK,
    mp4Path: r.mp4Path,
    htmlPath: r.htmlPath,
    networkLog: r.networkLog,
    onGate: (g) => {
      const tag = g.pass ? "PASS" : g.severity === "warn" ? "WARN" : "FAIL";
      console.log(`  ${tag.padEnd(5)} ${g.id}  (${g.durationMs ?? 0}ms)`);
    },
  });
} finally {
  // keep workDir around if FAIL_KEEP=1 to inspect the artifact
  if (!process.env.FAIL_KEEP) await rm(workDir, { recursive: true, force: true });
}

const expected: Record<string, "pass" | "warn-or-pass"> = {
  G1: "pass", // no remote assets in this composition
  G2: "pass", // builder is deterministic
  G3: "pass", // synthetic ffmpeg uses our duration exactly
  G4: "pass", // no caption blocks in MVP composition
  G5: "warn-or-pass", // synthetic has no audio → pass with hasAudio:false
  G6: "pass", // drawtext on a coloured background → meanY > threshold
  G7: "pass", // synthetic has no networkLog → skipped
  G8: "pass", // ffmpeg writes a clean MP4 with +faststart
};

let failed = 0;
for (const [id, want] of Object.entries(expected)) {
  const r = report[id as keyof GateReport];
  if (!r) {
    console.error(`  MISSING ${id}`);
    failed++;
    continue;
  }
  const ok = want === "pass" ? r.pass : r.pass || r.severity === "warn";
  if (!ok) {
    console.error(`  EXPECTED ${want} for ${id} but got pass=${r.pass} severity=${r.severity}: ${JSON.stringify(r.details)}`);
    failed++;
  }
}

if (failed > 0) {
  console.error(`\n${failed} gate expectation(s) failed.`);
  process.exit(1);
}
console.log("\nAll gate expectations satisfied.");
