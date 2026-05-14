/**
 * Quality gates run automatically on every render. The orchestrator records the
 * result of every gate on the jobs row and refuses to mark a render `succeeded`
 * until all blocking gates pass (or the user explicitly waives a gate, recorded
 * in the audit log).
 *
 * The gate *contracts* live here so the API edge, the worker, and the editor UI
 * all agree on identifiers and shapes. The actual *implementations* are in
 * apps/worker/src/gates/ where they have access to ffprobe, ffmpeg, the
 * HyperFrames lint API, and Chromium.
 */

import { z } from "zod";

export const GateIdSchema = z.enum(["G1", "G2", "G3", "G4", "G5", "G6", "G7", "G8"]);
export type GateId = z.infer<typeof GateIdSchema>;

export const GateSeveritySchema = z.enum(["block", "warn"]);
export type GateSeverity = z.infer<typeof GateSeveritySchema>;

export const GateResultSchema = z.object({
  id: GateIdSchema,
  pass: z.boolean(),
  severity: GateSeveritySchema,
  /** Free-form structured details for the editor UI to render. */
  details: z.record(z.unknown()).default({}),
  /** Human-readable suggested fix. The orchestrator may auto-apply some. */
  fix: z.string().optional(),
  /** Wall-clock duration of the gate check. */
  durationMs: z.number().nonnegative().optional(),
});
export type GateResult = z.infer<typeof GateResultSchema>;

/** Map of every gate's most recent result, keyed by GateId. */
export const GateReportSchema = z.record(GateIdSchema, GateResultSchema);
export type GateReport = z.infer<typeof GateReportSchema>;

/**
 * The catalog of gates. Severity is configurable per phase: in MVP (Phase 1)
 * G1, G2, G3, G7, G8 are blocking; G4, G5, G6 are warnings until calibrated.
 */
export const GATE_CATALOG: Record<
  GateId,
  { name: string; description: string; defaultSeverity: GateSeverity }
> = {
  G1: {
    name: "All assets exist",
    description:
      "Every asset referenced by the composition (videos, images, audio) is reachable. Missing or 404 assets fail the build before render time.",
    defaultSeverity: "block",
  },
  G2: {
    name: "HyperFrames lint passes",
    description:
      "@hyperframes/core lint reports no errors. Self-heal up to 2 retries before failure.",
    defaultSeverity: "block",
  },
  G3: {
    name: "Render duration matches expected",
    description:
      "ffprobe-reported duration of the rendered MP4 matches the composition's data-duration within ±1 frame.",
    defaultSeverity: "block",
  },
  G4: {
    name: "Captions inside title-safe area",
    description:
      "Caption bounding boxes stay within the preset's title-safe rectangle (typically 0.05..0.95 of canvas, tighter for vertical formats).",
    defaultSeverity: "warn",
  },
  G5: {
    name: "Audio not clipping",
    description:
      "ffmpeg volumedetect: max_volume <= -1.0 dBFS and no full-scale samples. Loudness within preset's LUFS target (e.g. -14 LUFS for YouTube).",
    defaultSeverity: "warn",
  },
  G6: {
    name: "No black/blank frames at key snapshots",
    description:
      "Frames sampled at 0, 25, 50, 75, 100% and at every cut boundary have mean luma > 5/255 and stddev > 2.",
    defaultSeverity: "warn",
  },
  G7: {
    name: "No network fetch during render",
    description:
      "Chromium emits Network.requestWillBeSent only for the file:// origin and the gsap+hyperframes-runtime CDN scripts. Anything else fails.",
    defaultSeverity: "block",
  },
  G8: {
    name: "Output file is playable",
    description:
      "ffprobe -v error exits 0; at least one video stream and (if expected) one audio stream; first frame decodes successfully.",
    defaultSeverity: "block",
  },
};

/** Identify the blocking subset of a report. */
export function blockingFailures(report: GateReport): GateResult[] {
  const failures: GateResult[] = [];
  for (const [id, result] of Object.entries(report)) {
    if (!result) continue;
    if (result.severity === "block" && !result.pass) failures.push(result);
  }
  return failures;
}

/** Convenience for the SSE bridge. */
export function summarize(report: GateReport): Record<GateId, "pass" | "warn" | "fail"> {
  const out = {} as Record<GateId, "pass" | "warn" | "fail">;
  for (const id of Object.keys(GATE_CATALOG) as GateId[]) {
    const r = report[id];
    if (!r) continue;
    out[id] = r.pass ? "pass" : r.severity === "warn" ? "warn" : "fail";
  }
  return out;
}
