/**
 * Render auto-fix layer. Some gate failures have well-known fixes the
 * orchestrator can apply transparently. We loop:
 *
 *   1. Render
 *   2. Run gates
 *   3. If a *fixable* gate failed, apply the fix and re-render once
 *   4. If gates still fail, the orchestrator surfaces them to the user
 *
 * Currently fixable:
 *   G3 (duration mismatch) → re-encode trimming/padding to data-duration
 *   G5 (audio not clipping / off-LUFS) → ffmpeg loudnorm at the preset target
 *
 * Anything else: surface the failure to the user; don't attempt magic.
 *
 * Each fix writes a new MP4 alongside the original (suffix `-fixed-<step>`)
 * and threads the path forward. We deliberately do NOT mutate the input file
 * in place: that race-condition'd against any reader that still holds the
 * original path (gate runner, persistComposition, future smoke retry harness).
 * The orchestrator's workDir cleanup covers temp-file pruning at end-of-job.
 */
import { join, dirname } from "node:path";
import { execa } from "execa";

import { loudnorm } from "@hyperframe-editor/ffmpeg";
import type { GateReport, Preset } from "@hyperframe-editor/core";

export interface AutoFixContext {
  mp4Path: string;
  expectedDurationSec: number;
  preset: Preset;
  /** Used only to log progress events; pass a no-op in offline tests. */
  publish?: (msg: string) => Promise<void>;
}

export interface AutoFixResult {
  appliedFixes: string[];
  newMp4Path: string;
}

export async function applyAutoFixes(
  ctx: AutoFixContext,
  report: GateReport,
): Promise<AutoFixResult> {
  let path = ctx.mp4Path;
  const applied: string[] = [];
  let stepCounter = 0;

  // ---- G3: duration mismatch — pad or trim ---------------------------------
  if (report.G3 && !report.G3.pass) {
    await ctx.publish?.(`auto-fix: G3 — re-encoding to ${ctx.expectedDurationSec}s`);
    const fixed = join(
      dirname(path),
      `g3-fixed-${++stepCounter}-${Date.now()}.mp4`,
    );
    await execa(
      "ffmpeg",
      [
        "-y",
        "-i",
        path,
        "-t",
        ctx.expectedDurationSec.toFixed(3),
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        "-c:a",
        "copy",
        fixed,
      ],
      { reject: true },
    );
    path = fixed;
    applied.push("G3:duration-trim");
  }

  // ---- G5: audio off-target — loudnorm pass --------------------------------
  if (report.G5 && !report.G5.pass) {
    await ctx.publish?.(
      `auto-fix: G5 — applying loudnorm I=${ctx.preset.guardrails.lufsTarget}`,
    );
    const fixed = join(
      dirname(path),
      `g5-fixed-${++stepCounter}-${Date.now()}.mp4`,
    );
    try {
      await loudnorm(path, fixed, ctx.preset.guardrails.lufsTarget);
      path = fixed;
      applied.push("G5:loudnorm");
    } catch (e) {
      await ctx.publish?.(`auto-fix: G5 loudnorm failed: ${(e as Error).message}`);
    }
  }

  return { appliedFixes: applied, newMp4Path: path };
}

/**
 * Predicate: does this gate report contain a fix the runner is willing to
 * attempt? The orchestrator calls this BEFORE wasting a second render pass on
 * un-fixable failures.
 */
export function hasAutoFixableFailure(report: GateReport): boolean {
  return Boolean(
    (report.G3 && !report.G3.pass) || (report.G5 && !report.G5.pass),
  );
}
