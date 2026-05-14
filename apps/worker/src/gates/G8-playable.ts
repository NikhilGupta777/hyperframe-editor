/**
 * G8 — output file is playable.
 *
 *   ffprobe -v error exits 0
 *   at least one video stream
 *   first frame decodes
 */
import { isPlayable, probe } from "@hyperframe-editor/ffmpeg";
import type { GateContext } from "./runner.js";
import type { GateResult } from "@hyperframe-editor/core";

export async function gateG8(ctx: GateContext): Promise<Omit<GateResult, "id" | "severity">> {
  if (!ctx.mp4Path) return { pass: false, details: { reason: "no mp4Path" } };
  const playable = await isPlayable(ctx.mp4Path);
  if (!playable.ok) {
    return {
      pass: false,
      details: { reason: playable.details },
      fix: "re-encode with `-c:v libx264 -movflags +faststart` and re-test",
    };
  }
  const p = await probe(ctx.mp4Path);
  if (!p.hasVideo) {
    return {
      pass: false,
      details: { reason: "no video stream" },
      fix: "renderer produced a video-less output; check Chromium errors",
    };
  }
  return { pass: true, details: { codec: p.videoCodec, duration: p.durationSec } };
}
