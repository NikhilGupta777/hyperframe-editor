/**
 * Gate runner. Calls each gate, records timings, returns a GateReport.
 *
 * Gates are *additive* — failures in one gate do not skip subsequent gates so
 * the editor UI can show the full picture. The orchestrator decides what to
 * do with the report (e.g. block on G1+G2+G3+G7+G8 in MVP).
 */
import {
  type Composition,
  type Preset,
  type GateId,
  type GateReport,
  type GateResult,
  GATE_CATALOG,
} from "@hyperframe-editor/core";

import { gateG1 } from "./G1-assets.js";
import { gateG2 } from "./G2-lint.js";
import { gateG3 } from "./G3-duration.js";
import { gateG4 } from "./G4-captions.js";
import { gateG5 } from "./G5-audio.js";
import { gateG6 } from "./G6-frames.js";
import { gateG7 } from "./G7-network.js";
import { gateG8 } from "./G8-playable.js";

export interface GateContext {
  projectId: string;
  composition: Composition;
  preset: Preset;
  /** Local path to the rendered MP4 (post-RENDER). */
  mp4Path?: string;
  /** Local path to the composition HTML used for the render. */
  htmlPath?: string;
  /** URLs the renderer's Chromium fetched, captured by the render pipeline. */
  networkLog?: string[];
  /** Severity overrides per gate (Phase 2 may flip warns to blocks). */
  severityOverrides?: Partial<Record<GateId, "block" | "warn">>;
  onGate?: (g: GateResult) => void | Promise<void>;
}

export async function runGates(ctx: GateContext): Promise<GateReport> {
  const report: GateReport = {};
  const order: GateId[] = ["G1", "G2", "G3", "G4", "G5", "G6", "G7", "G8"];
  const runners: Record<GateId, (c: GateContext) => Promise<Omit<GateResult, "id" | "severity">>> = {
    G1: gateG1,
    G2: gateG2,
    G3: gateG3,
    G4: gateG4,
    G5: gateG5,
    G6: gateG6,
    G7: gateG7,
    G8: gateG8,
  };

  for (const id of order) {
    const t0 = Date.now();
    let inner: Omit<GateResult, "id" | "severity">;
    try {
      inner = await runners[id](ctx);
    } catch (e) {
      inner = {
        pass: false,
        details: { error: e instanceof Error ? e.message : String(e) },
        fix: "internal gate failure; see error in details",
      };
    }
    const severity =
      ctx.severityOverrides?.[id] ?? GATE_CATALOG[id].defaultSeverity;
    const result: GateResult = {
      id,
      severity,
      pass: inner.pass,
      details: inner.details ?? {},
      fix: inner.fix,
      durationMs: Date.now() - t0,
    };
    report[id] = result;
    await ctx.onGate?.(result);
  }
  return report;
}
