/**
 * G5 — audio doesn't clip and meets the preset's loudness target.
 *
 * MVP heuristic uses ffmpeg `volumedetect`:
 *   - max_volume <= -1.0 dBFS  → no clipping
 *   - mean_volume in [-25, -8] dBFS → reasonable loudness range
 *
 * If the rendered MP4 has no audio stream (e.g. muted preset), we pass with
 * details {hasAudio: false}.
 */
import { probe, volumeDetect } from "@hyperframe-editor/ffmpeg";
import type { GateContext } from "./runner.js";
import type { GateResult } from "@hyperframe-editor/core";

export async function gateG5(ctx: GateContext): Promise<Omit<GateResult, "id" | "severity">> {
  if (!ctx.mp4Path) return { pass: false, details: { reason: "no mp4Path" } };
  const p = await probe(ctx.mp4Path);
  if (!p.hasAudio) {
    return { pass: true, details: { hasAudio: false } };
  }
  const v = await volumeDetect(ctx.mp4Path);
  const clipping = !Number.isNaN(v.maxVolumeDb) && v.maxVolumeDb > -1.0;
  const tooQuiet = !Number.isNaN(v.meanVolumeDb) && v.meanVolumeDb < -25;
  const tooLoud = !Number.isNaN(v.meanVolumeDb) && v.meanVolumeDb > -8;
  const pass = !clipping && !tooQuiet && !tooLoud;
  return {
    pass,
    details: {
      hasAudio: true,
      meanVolumeDb: v.meanVolumeDb,
      maxVolumeDb: v.maxVolumeDb,
      lufsTarget: ctx.preset.guardrails.lufsTarget,
      clipping,
      tooQuiet,
      tooLoud,
    },
    fix: pass
      ? undefined
      : `apply ffmpeg loudnorm=I=${ctx.preset.guardrails.lufsTarget} re-encode-audio-only`,
  };
}
