/**
 * G4 — caption blocks live inside the title-safe area.
 *
 * MVP heuristic: scan the composition AST for clips whose block name suggests
 * captions; check their props for explicit position fractions. If a caption
 * block is positioned outside the preset's titleSafe window, fail.
 *
 * Phase 2 layer: render the caption frame from Chromium and bound-box-detect
 * with imgproc instead of relying on metadata.
 */
import type { GateContext } from "./runner.js";
import type { GateResult } from "@hyperframe-editor/core";

const CAPTION_LIKE = new Set(["CaptionBlock", "LowerThird", "Subtitles", "ScriptureCard", "QuoteCard"]);

export async function gateG4(ctx: GateContext): Promise<Omit<GateResult, "id" | "severity">> {
  const [low, high] = ctx.preset.guardrails.titleSafe;
  const issues: Array<{ clipId: string; rect: number[] }> = [];
  for (const clip of ctx.composition.clips) {
    if (clip.kind !== "block" || !clip.block || !CAPTION_LIKE.has(clip.block)) continue;
    const rect = (clip.props as { rect?: number[] }).rect;
    if (!rect || rect.length !== 4) continue; // unspecified == default safe area
    const [x0, y0, x1, y1] = rect as [number, number, number, number];
    if (x0 < low || y0 < low || x1 > high || y1 > high) {
      issues.push({ clipId: clip.id, rect: rect as number[] });
    }
  }
  if (issues.length === 0) {
    return { pass: true, details: { checked: ctx.composition.clips.length, titleSafe: [low, high] } };
  }
  return {
    pass: false,
    details: { issues, titleSafe: [low, high] },
    fix: "rescale or reposition the offending caption blocks within the title-safe rectangle",
  };
}
