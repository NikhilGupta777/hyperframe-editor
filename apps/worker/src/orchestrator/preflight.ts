/**
 * Render preflight. Run before any heavy render to catch bugs early.
 *
 *   1. dryRender: confirm composition lints + renders 1 frame in <500ms
 *   2. cost estimate: tally token / image / render-second projections, refuse
 *      if the project's remaining budget can't cover them
 *
 * Failure here should ALWAYS be caught and surfaced as a visible warning
 * before we commit to the real render.
 */
import type { Composition, Preset } from "@hyperframe-editor/core";
import { dryRender } from "../tools/dryRender.js";
import { priceRender, assertWithinBudget } from "./cost.js";

export interface PreflightArgs {
  composition: Composition;
  preset: Preset;
  budgetUsd: number;
  spentUsd: number;
}

export interface PreflightResult {
  dryOk: boolean;
  dryMs: number;
  estimateUsd: number;
  remainingUsd: number;
}

export async function preflight(args: PreflightArgs): Promise<PreflightResult> {
  const dry = await dryRender(args.composition, args.preset);
  if (!dry.ok) {
    throw new Error(`preflight: dry render failed (${dry.lintErrors} lint error(s))`);
  }

  // Render-second estimate: assume 1× realtime on the synthetic backend; for
  // hyperframes Chromium it'll be 2-3× depending on quality preset.
  const estSeconds = args.composition.duration * 1.5;
  const cost = priceRender(estSeconds);
  assertWithinBudget({
    budgetUsd: args.budgetUsd,
    spentUsd: args.spentUsd,
    estimateUsd: cost.costUsd,
  });

  return {
    dryOk: true,
    dryMs: dry.ms,
    estimateUsd: cost.costUsd,
    remainingUsd: args.budgetUsd - args.spentUsd - cost.costUsd,
  };
}
