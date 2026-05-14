/**
 * Smoke test for the AST mutation tools. Each function should be pure: same
 * input always produces the same output, original is never modified.
 */
import {
  type Composition,
  TIKTOK_HOOK,
  computeDuration,
} from "@hyperframe-editor/core";
import {
  addClip,
  deleteClip,
  moveClip,
  setCompositionMeta,
  setTrackOrder,
  trimClip,
} from "../src/tools/composition.js";

const start: Composition = {
  id: "comp-smoke",
  canvas: TIKTOK_HOOK.canvas,
  duration: 4,
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
      props: { text: "smoke" },
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
start.duration = computeDuration(start);

let failed = 0;
const startClone = JSON.parse(JSON.stringify(start));

// 1. moveClip
{
  const after = moveClip(start, { clipId: "h", start: 1, trackIndex: 1 });
  const moved = after.clips.find((c) => c.id === "h")!;
  if (moved.start !== 1 || moved.trackIndex !== 1) {
    console.error("FAIL  moveClip", moved);
    failed++;
  } else console.log("PASS  moveClip");
}

// 2. trimClip
{
  const after = trimClip(start, { clipId: "e", duration: 0.5 });
  const trimmed = after.clips.find((c) => c.id === "e")!;
  if (Math.abs(trimmed.duration - 0.5) > 1e-6) {
    console.error("FAIL  trimClip", trimmed);
    failed++;
  } else console.log("PASS  trimClip");
}

// 3. addClip
{
  const after = addClip(start, {
    clip: { kind: "block", block: "LowerThird", duration: 1.5, props: { name: "Speaker" } },
  });
  if (after.clips.length !== 3) {
    console.error("FAIL  addClip count", after.clips);
    failed++;
  } else console.log("PASS  addClip");
}

// 4. deleteClip
{
  const after = deleteClip(start, { clipId: "h" });
  if (after.clips.find((c) => c.id === "h")) {
    console.error("FAIL  deleteClip");
    failed++;
  } else console.log("PASS  deleteClip");
}

// 5. setCompositionMeta
{
  const after = setCompositionMeta(start, {
    width: 1920,
    height: 1080,
    variables: { brand: "hyperframe" },
  });
  if (after.canvas.width !== 1920 || after.variables.brand !== "hyperframe") {
    console.error("FAIL  setCompositionMeta", after.canvas, after.variables);
    failed++;
  } else console.log("PASS  setCompositionMeta");
}

// 6. setTrackOrder
{
  const after = setTrackOrder(start, { trackIndex: 0, orderedClipIds: ["e", "h"] });
  if (after.clips[0]?.id !== "e") {
    console.error("FAIL  setTrackOrder", after.clips.map((c) => c.id));
    failed++;
  } else console.log("PASS  setTrackOrder");
}

// 7. purity check — original must be untouched after all mutations
if (JSON.stringify(start) !== JSON.stringify(startClone)) {
  console.error("FAIL  original composition was mutated");
  failed++;
} else console.log("PASS  original composition not mutated");

if (failed > 0) process.exit(1);
console.log("\ncomposition smoke OK.");
