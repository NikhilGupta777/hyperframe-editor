/**
 * Smoke test for the TWEAK loop. Saves a known composition, runs runTweakLoop
 * with a "make the title bigger" instruction, asserts the AST changed in the
 * expected way (HookTitle's fontScale gets bumped).
 *
 * Does NOT require Vertex (uses the offline localTweak grammar).
 */
import {
  type Composition,
  TIKTOK_HOOK,
  computeDuration,
} from "@hyperframe-editor/core";
import { setEventTap, type JobEvent, type QueuedJob } from "@hyperframe-editor/queue";

import { persistComposition } from "../src/orchestrator/persist.js";
import { runTweakLoop } from "../src/orchestrator/tweak.js";

const events: JobEvent[] = [];
setEventTap((_id, e) => {
  events.push(e);
});

const projectId = "tweak-smoke";

const start: Composition = {
  id: projectId,
  canvas: TIKTOK_HOOK.canvas,
  duration: 4,
  assets: [],
  variables: {},
  clips: [
    {
      id: "h1",
      kind: "block",
      block: "HookTitle",
      trackIndex: 0,
      start: 0,
      duration: 2,
      playbackOffset: 0,
      props: { text: "before tweak" },
    },
    {
      id: "c1",
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

await persistComposition.save(projectId, start, /* html irrelevant */ "");

const job: QueuedJob = {
  jobId: "tweak-smoke-job",
  kind: "tweak",
  projectId,
  payload: { prompt: "make the title bigger" } as Record<string, unknown>,
};

await runTweakLoop(job);

const after = await persistComposition.load(projectId);
const hook = after.clips.find((c) => c.block === "HookTitle");
const fontScale = (hook?.props as { fontScale?: number }).fontScale ?? 1;

const done = events.find((e) => e.type === "done");

if (!done) {
  console.error("missing done event");
  process.exit(1);
}
if (fontScale <= 1) {
  console.error(`expected fontScale > 1, got ${fontScale}`);
  process.exit(1);
}
console.log(`tweak smoke OK. fontScale=${fontScale.toFixed(3)}`);
