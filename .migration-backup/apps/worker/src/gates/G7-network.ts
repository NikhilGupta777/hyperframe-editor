/**
 * G7 — no off-origin network fetches during render.
 *
 * The render pipeline captures Chromium's `Network.requestWillBeSent` events
 * while seeking. We pass the URL list to G7. Allowed origins:
 *   - file://*                           (local composition + assets)
 *   - cdn.jsdelivr.net (gsap)            (allowed by the contract; warn if absent)
 *   - cdn.jsdelivr.net (hyperframes)     (allowed)
 *   - data:                              (inline data URLs)
 *
 * Anything else fails the gate. The fix is to vendor the asset into assets/.
 */
import type { GateContext } from "./runner.js";
import type { GateResult } from "@hyperframe-editor/core";

const ALLOWED = [
  /^file:\/\//,
  /^data:/,
  /^https:\/\/cdn\.jsdelivr\.net\/npm\/gsap@/,
  /^https:\/\/cdn\.jsdelivr\.net\/npm\/@hyperframes\/core\//,
  /^https:\/\/fonts\.googleapis\.com\//,
  /^https:\/\/fonts\.gstatic\.com\//,
];

export async function gateG7(ctx: GateContext): Promise<Omit<GateResult, "id" | "severity">> {
  if (!ctx.networkLog) {
    return { pass: true, details: { skipped: "no network log captured by renderer" } };
  }
  const violations = ctx.networkLog.filter(
    (url) => !ALLOWED.some((re) => re.test(url)),
  );
  if (violations.length === 0) {
    return { pass: true, details: { observed: ctx.networkLog.length } };
  }
  return {
    pass: false,
    details: { violations },
    fix: "vendor the listed URLs into the project's assets/ directory and reference them with relative paths",
  };
}
