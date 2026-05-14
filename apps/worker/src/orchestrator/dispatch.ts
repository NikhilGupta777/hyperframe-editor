import type { QueuedJob } from "@hyperframe-editor/queue";
import { runComposeLoop } from "./compose.js";

/**
 * Top-level dispatcher. Each `kind` corresponds to one of the state machines
 * documented in PLAN.md §4.
 */
export async function handleJob(job: QueuedJob): Promise<void> {
  switch (job.kind) {
    case "compose":
      await runComposeLoop(job);
      return;
    case "render": {
      // Phase 1: a render-only job is just a thin wrapper around compose's
      // RENDER step on an existing project. We resolve it via runComposeLoop
      // with a `renderOnly` payload flag.
      await runComposeLoop({ ...job, payload: { ...job.payload, renderOnly: true } });
      return;
    }
    default:
      throw new Error(`Unknown job kind: ${job.kind}`);
  }
}
