import type { QueuedJob } from "@hyperframe-editor/queue";
import { runComposeLoop } from "./compose.js";
import { runEditSourceLoop } from "./editSource.js";
import { runTweakLoop } from "./tweak.js";

/**
 * Top-level dispatcher. Each `kind` corresponds to one of the state machines
 * documented in PLAN.md §4.
 */
export async function handleJob(job: QueuedJob): Promise<void> {
  switch (job.kind) {
    case "compose":
    case "build":
      await runComposeLoop(job);
      return;
    case "edit_source":
    case "edit-source":
      await runEditSourceLoop(job);
      return;
    case "tweak":
      await runTweakLoop(job);
      return;
    case "render": {
      // A render-only job is a thin wrapper around compose's RENDER step on an
      // existing project. We resolve it via runComposeLoop with a `renderOnly`
      // payload flag.
      await runComposeLoop({
        ...job,
        payload: { ...job.payload, renderOnly: true },
      });
      return;
    }
    default:
      throw new Error(`Unknown job kind: ${job.kind}`);
  }
}
