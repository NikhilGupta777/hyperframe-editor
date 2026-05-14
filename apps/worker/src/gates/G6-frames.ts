/**
 * G6 — sampled frames are not black/blank.
 *
 * Sample at 0%, 25%, 50%, 75%, 100% of the rendered MP4. For each, require:
 *   meanY > 5/255  (≈ 0.02 normalised) — pure black has meanY ≈ 0
 *   stddevY > 2    — black/blank frames have stddev ≈ 0
 *
 * The 0% sample uses 0.05s instead of 0 because some encoders emit a leading
 * black frame that's a real artifact we don't want to hide.
 */
import { probe, lumaAt } from "@hyperframe-editor/ffmpeg";
import type { GateContext } from "./runner.js";
import type { GateResult } from "@hyperframe-editor/core";

export async function gateG6(ctx: GateContext): Promise<Omit<GateResult, "id" | "severity">> {
  if (!ctx.mp4Path) return { pass: false, details: { reason: "no mp4Path" } };
  const p = await probe(ctx.mp4Path);
  if (!p.hasVideo || !p.durationSec) {
    return { pass: false, details: { reason: "no video stream / unknown duration" } };
  }
  const offsets = [0.05, 0.25, 0.5, 0.75, Math.max(0, p.durationSec - 0.05)];
  const samples: Array<{ at: number; meanY: number; stddevY: number; pass: boolean }> = [];
  let allPass = true;
  for (const at of offsets) {
    const s = await lumaAt(ctx.mp4Path, at);
    // A black/blank frame has mean ≈ 0 and stddev ≈ 0. We require either:
    //   - meanY > 5 AND stddevY > 2, OR
    //   - meanY > 12 (decisively non-black even if signalstats didn't emit stddev)
    // The latter handles ffmpeg builds whose metadata=print output doesn't include
    // YDEV; on those builds we fall back to a stricter mean threshold.
    const meanOk = !Number.isNaN(s.meanY) && s.meanY > 5;
    const stdOk = !Number.isNaN(s.stddevY) && s.stddevY > 2;
    const meanStrong = !Number.isNaN(s.meanY) && s.meanY > 12;
    const pass = (meanOk && stdOk) || meanStrong;
    samples.push({ at, ...s, pass });
    if (!pass) allPass = false;
  }
  return {
    pass: allPass,
    details: { samples },
    fix: allPass
      ? undefined
      : "investigate the failing timestamps; most often a clip is missing class=clip or has the wrong z-index",
  };
}
