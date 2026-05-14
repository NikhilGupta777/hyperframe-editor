/**
 * Smoke test for ffmpeg EDL concatenation. Synthesises two short clips with
 * different audio frequencies, concats a 1.5s slice from each, asserts the
 * output is the expected duration and contains both audio + video streams.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execa } from "execa";
import { concatCuts, probe } from "@hyperframe-editor/ffmpeg";

const work = await mkdtemp(join(tmpdir(), "hf-concat-"));
console.log(`workDir = ${work}`);
let failed = 0;

try {
  const a = join(work, "a.mp4");
  const b = join(work, "b.mp4");
  // 4-second clips at 320x240 with distinct sine tones.
  await execa(
    "ffmpeg",
    [
      "-y",
      "-f",
      "lavfi",
      "-i",
      "color=c=0x113355:s=320x240:d=4:r=30",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:sample_rate=44100:duration=4",
      "-shortest",
      "-pix_fmt",
      "yuv420p",
      a,
    ],
    { reject: true },
  );
  await execa(
    "ffmpeg",
    [
      "-y",
      "-f",
      "lavfi",
      "-i",
      "color=c=0x553311:s=320x240:d=4:r=30",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=880:sample_rate=44100:duration=4",
      "-shortest",
      "-pix_fmt",
      "yuv420p",
      b,
    ],
    { reject: true },
  );

  const out = join(work, "out.mp4");
  await concatCuts(
    [
      { src: a, in: 0.5, out: 2.0 },
      { src: b, in: 1.0, out: 2.5 },
    ],
    out,
    { width: 720, height: 1280, fps: 30, audio: true },
  );

  const p = await probe(out);
  console.log(`out: ${p.durationSec.toFixed(2)}s, ${p.width}x${p.height}, audio=${p.hasAudio}`);
  if (Math.abs(p.durationSec - 3) > 0.2) {
    console.error(`FAIL  duration mismatch: expected ~3s, got ${p.durationSec.toFixed(2)}s`);
    failed++;
  } else console.log("PASS  concat duration");
  if (p.width !== 720 || p.height !== 1280) {
    console.error(`FAIL  scale mismatch: ${p.width}x${p.height}`);
    failed++;
  } else console.log("PASS  output scale");
  if (!p.hasAudio || !p.hasVideo) {
    console.error(`FAIL  missing streams (video=${p.hasVideo}, audio=${p.hasAudio})`);
    failed++;
  } else console.log("PASS  audio+video streams");
} finally {
  await rm(work, { recursive: true, force: true });
}

if (failed > 0) process.exit(1);
console.log("\nconcat smoke OK.");
