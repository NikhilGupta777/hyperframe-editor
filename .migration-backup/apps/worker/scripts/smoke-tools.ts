/**
 * Smoke test for the editor tools we just wired:
 *  - silenceCut on a synthetic video that contains a quiet-loud-quiet pattern
 *  - autoCaption on a tiny transcript, both tiktok and subtitle styles
 *
 * Requires ffmpeg in PATH. No Vertex / OCI / Postgres / Redis.
 */
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execa } from "execa";

import { silenceCut } from "../src/tools/silenceCut.js";
import { autoCaption } from "../src/tools/autoCaption.js";
import { TOOL_IMPLS } from "../src/tools/index.js";

const workDir = await mkdtemp(join(tmpdir(), "hf-tools-smoke-"));
console.log(`workDir = ${workDir}`);
let failed = 0;

try {
  // Build a 6s video with audio: 2s silent + 2s sine + 2s silent.
  const sourcePath = join(workDir, "src.mp4");
  await execa(
    "ffmpeg",
    [
      "-y",
      "-f",
      "lavfi",
      "-i",
      "color=c=0x222244:s=320x240:d=6:r=30",
      "-f",
      "lavfi",
      "-i",
      "aevalsrc=if(between(t\\,2\\,4)\\,0.5*sin(2*PI*440*t)\\,0):s=16000:d=6",
      "-shortest",
      "-pix_fmt",
      "yuv420p",
      sourcePath,
    ],
    { reject: true },
  );

  const result = await silenceCut({ sourceUri: sourcePath, noiseDb: -25, minDurationSec: 0.4 });
  // We expect at least one kept segment overlapping the 2-4s sine region.
  const overlapsSine = result.kept.some((k) => k.start <= 3 && k.end >= 3);
  if (!overlapsSine) {
    console.error("FAIL  silenceCut did not keep the audible region:", result.kept);
    failed++;
  } else {
    console.log(`PASS  silenceCut kept ${result.kept.length} segment(s)`);
  }

  // autoCaption — tiktok variant
  const segs = [
    { start: 0, end: 2, text: "this is a tiny test segment", speaker: "S0" },
    { start: 2, end: 4, text: "captions split into chunks", speaker: "S0" },
  ];
  const tt = await autoCaption(segs, { variant: "tiktok" });
  // 6 words then 4 words → 3+2 = 5 lines
  if (tt.lines.length !== 5) {
    console.error(`FAIL  tiktok captions: expected 5, got ${tt.lines.length}`);
    failed++;
  } else {
    console.log("PASS  tiktok captions chunked correctly");
  }
  // autoCaption — subtitle variant + SRT export
  const srtPath = join(workDir, "out.srt");
  const sub = await autoCaption(segs, { variant: "subtitle", maxChars: 18 }, srtPath);
  const srtText = await readFile(srtPath, "utf8");
  if (!/-->/.test(srtText) || sub.lines.length === 0) {
    console.error("FAIL  subtitle SRT export missing arrow / lines");
    failed++;
  } else {
    console.log(`PASS  subtitle SRT (${sub.lines.length} lines)`);
  }

  const estimate = (await TOOL_IMPLS.cost_estimate(
    { workDir, projectId: "tools-smoke" },
    {
      composition: {
        id: "tools-smoke",
        canvas: { width: 1080, height: 1920, fps: 30 },
        duration: 4,
        assets: [],
        clips: [
          {
            id: "clip-1",
            kind: "block",
            block: "HookTitle",
            trackIndex: 0,
            start: 0,
            duration: 4,
            playbackOffset: 0,
            props: { text: "Tool smoke" },
          },
        ],
        variables: {},
      },
    },
  )) as { entries?: Array<{ costUsd: number }> };
  if (!estimate.entries?.[0] || estimate.entries[0].costUsd <= 0) {
    console.error("FAIL  dispatcher cost_estimate did not return a positive render estimate");
    failed++;
  } else {
    console.log("PASS  dispatcher cost_estimate wired");
  }
} finally {
  await rm(workDir, { recursive: true, force: true });
}

if (failed > 0) process.exit(1);
console.log("\ntools smoke OK.");
