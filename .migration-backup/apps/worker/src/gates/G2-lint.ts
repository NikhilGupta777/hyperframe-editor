/**
 * G2 — HyperFrames lint passes.
 *
 * We use our portable lint (apps/worker/src/agents/lintHeal#lintHtml) so the
 * worker doesn't need @hyperframes/core in its image. The contract is identical.
 */
import { promises as fs } from "node:fs";
import type { GateContext } from "./runner.js";
import type { GateResult } from "@hyperframe-editor/core";
import { lintHtml } from "../agents/lintHeal.js";

export async function gateG2(ctx: GateContext): Promise<Omit<GateResult, "id" | "severity">> {
  if (!ctx.htmlPath) {
    return {
      pass: false,
      details: { reason: "no htmlPath available" },
      fix: "ensure the orchestrator wrote the composition HTML to disk before running gates",
    };
  }
  const html = await fs.readFile(ctx.htmlPath, "utf8");
  const errors = lintHtml(html);
  if (errors.length === 0) return { pass: true, details: { errors } };
  return {
    pass: false,
    details: { errors },
    fix: "self-heal already exhausted; inspect builder output for the offending rule",
  };
}
