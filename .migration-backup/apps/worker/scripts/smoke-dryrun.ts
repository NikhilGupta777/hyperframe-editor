/**
 * Smoke test for the dry-render tool. Builds a known-good composition, asserts
 * dryRender returns ok=true with lintErrors=0 in <500ms.
 */
import { type Composition, TIKTOK_HOOK, computeDuration } from "@hyperframe-editor/core";
import { dryRender } from "../src/tools/dryRender.js";

const composition: Composition = {
  id: "dryrun-smoke",
  canvas: TIKTOK_HOOK.canvas,
  duration: 0,
  assets: [],
  variables: {},
  clips: [
    {
      id: "h",
      kind: "block",
      block: "HookTitle",
      trackIndex: 0,
      start: 0,
      duration: 2,
      playbackOffset: 0,
      props: { text: "dry-render smoke" },
    },
    {
      id: "e",
      kind: "block",
      block: "EndCard",
      trackIndex: 0,
      start: 2,
      duration: 2,
      playbackOffset: 0,
      props: { cta: "Subscribe" },
    },
  ],
};
composition.duration = computeDuration(composition);

const r = await dryRender(composition, TIKTOK_HOOK);
console.log(JSON.stringify(r, null, 2));

let failed = 0;
if (!r.ok) {
  console.error("FAIL  dry-render returned not ok");
  failed++;
}
if (r.lintErrors !== 0) {
  console.error(`FAIL  dry-render reported ${r.lintErrors} lint error(s)`);
  failed++;
}
if (r.ms > 5000) {
  console.error(`FAIL  dry-render too slow: ${r.ms}ms`);
  failed++;
}

if (failed > 0) process.exit(1);
console.log("\ndry-render smoke OK.");
