/**
 * Failure-mode smoke. Builds compositions that VIOLATE the gates, runs the
 * gate runner, and asserts the right gates fail.
 *
 * Why? "Gates that always pass" are useless. We need to prove the gates
 * actually catch the bugs they claim to catch.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execa } from "execa";

import {
  type Composition,
  TIKTOK_HOOK,
  computeDuration,
} from "@hyperframe-editor/core";
import { runGates } from "../src/gates/runner.js";

const workDir = await mkdtemp(join(tmpdir(), "hf-fail-smoke-"));
console.log(`workDir = ${workDir}`);
let failed = 0;

async function buildHtml(html: string): Promise<{ htmlPath: string; mp4Path: string }> {
  const htmlPath = join(workDir, `comp.html`);
  await writeFile(htmlPath, html, "utf8");
  // Minimal valid MP4 so G3 / G6 / G8 have something to evaluate.
  const mp4Path = join(workDir, "out.mp4");
  await execa(
    "ffmpeg",
    [
      "-y",
      "-f",
      "lavfi",
      "-i",
      "color=c=0x223344:s=1080x1920:d=4:r=30",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      mp4Path,
    ],
    { reject: true },
  );
  return { htmlPath, mp4Path };
}

const baseComp: Composition = {
  id: "fail-smoke",
  canvas: TIKTOK_HOOK.canvas,
  duration: 4,
  assets: [],
  variables: {},
  clips: [
    {
      id: "h1",
      kind: "block",
      block: "HookTitle",
      trackIndex: 0,
      start: 0,
      duration: 4,
      playbackOffset: 0,
      props: { text: "fail smoke" },
    },
  ],
};
baseComp.duration = computeDuration(baseComp);

// ---- Test 1: G2 should fail when the HTML is broken (missing root attrs) ----
{
  const broken = `<!DOCTYPE html><html><body><div></div></body></html>`;
  const { htmlPath, mp4Path } = await buildHtml(broken);
  const r = await runGates({
    projectId: "f1",
    composition: baseComp,
    preset: TIKTOK_HOOK,
    mp4Path,
    htmlPath,
  });
  if (r.G2 && !r.G2.pass) {
    console.log("PASS  G2 caught broken HTML");
  } else {
    console.error("FAIL  G2 did not fail on broken HTML:", r.G2);
    failed++;
  }
}

// ---- Test 2: G7 should fail when the network log includes an off-origin URL ----
{
  const validHtml = await import("@hyperframe-editor/compose").then((m) =>
    m.buildCompositionHtml({ preset: TIKTOK_HOOK, composition: baseComp }),
  );
  const { htmlPath, mp4Path } = await buildHtml(validHtml);
  const r = await runGates({
    projectId: "f2",
    composition: baseComp,
    preset: TIKTOK_HOOK,
    mp4Path,
    htmlPath,
    networkLog: ["https://evil.example.com/bad.png", "https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"],
  });
  if (r.G7 && !r.G7.pass) {
    console.log("PASS  G7 caught off-origin URL");
  } else {
    console.error("FAIL  G7 did not fail on off-origin URL:", r.G7);
    failed++;
  }
}

// ---- Test 3: G3 should fail when the rendered duration disagrees with composition.duration ----
{
  const longerComp: Composition = JSON.parse(JSON.stringify(baseComp));
  longerComp.duration = 30; // intentionally lying
  const validHtml = await import("@hyperframe-editor/compose").then((m) =>
    m.buildCompositionHtml({ preset: TIKTOK_HOOK, composition: baseComp }),
  );
  const { htmlPath, mp4Path } = await buildHtml(validHtml);
  const r = await runGates({
    projectId: "f3",
    composition: longerComp,
    preset: TIKTOK_HOOK,
    mp4Path,
    htmlPath,
  });
  if (r.G3 && !r.G3.pass) {
    console.log("PASS  G3 caught duration mismatch");
  } else {
    console.error("FAIL  G3 did not fail on duration mismatch:", r.G3);
    failed++;
  }
}

// ---- Test 4: G1 should fail when an asset reference doesn't exist ----
{
  const compWithBadAsset: Composition = {
    ...baseComp,
    assets: [{ id: "ghost", kind: "image", src: "/nonexistent/path/to/file.png" }],
  };
  const validHtml = await import("@hyperframe-editor/compose").then((m) =>
    m.buildCompositionHtml({ preset: TIKTOK_HOOK, composition: baseComp }),
  );
  const { htmlPath, mp4Path } = await buildHtml(validHtml);
  const r = await runGates({
    projectId: "f4",
    composition: compWithBadAsset,
    preset: TIKTOK_HOOK,
    mp4Path,
    htmlPath,
  });
  if (r.G1 && !r.G1.pass) {
    console.log("PASS  G1 caught missing asset");
  } else {
    console.error("FAIL  G1 did not fail on missing asset:", r.G1);
    failed++;
  }
}

await rm(workDir, { recursive: true, force: true });

if (failed > 0) {
  console.error(`\n${failed} failure-mode test(s) did not behave correctly.`);
  process.exit(1);
}
console.log("\nfailure-mode smoke OK.");
