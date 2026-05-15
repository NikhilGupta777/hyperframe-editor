/**
 * G3 — render duration matches expected within ±1 frame.
 */
import { probe } from "@hyperframe-editor/ffmpeg";
import type { GateContext } from "./runner.js";
import type { GateResult } from "@hyperframe-editor/core";

export async function gateG3(ctx: GateContext): Promise<Omit<GateResult, "id" | "severity">> {
  if (!ctx.mp4Path) {
    return { pass: false, details: { reason: "no mp4Path" } };
  }
  const probed = await probe(ctx.mp4Path);
  const expected = ctx.composition.duration;
  const fps = ctx.composition.canvas.fps || 30;
  const oneFrame = 1 / fps;
  const diff = Math.abs(probed.durationSec - expected);
  const pass = diff <= oneFrame + 1e-6;
  return {
    pass,
    details: { expected, actual: probed.durationSec, oneFrame },
    fix: pass
      ? undefined
      : "add tl.set({}, {}, <totalDuration>) to extend the GSAP timeline to the composition's data-duration",
  };
}
