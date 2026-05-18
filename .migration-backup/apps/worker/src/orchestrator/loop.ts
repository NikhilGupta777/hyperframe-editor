/**
 * Consumer loop. Pulls one job at a time from the Redis stream, dispatches by
 * `kind`, acks on success, leaves un-acked on failure (so XPENDING surfaces it
 * for retry / DLQ).
 *
 * Concurrency is intentionally 1 per worker process: HyperFrames renders fan
 * out into multiple Chrome workers internally, so vertical scaling is the right
 * dimension. Horizontal scaling is "more worker pods".
 */
import { ackJob, readJobs, type QueuedJob } from "@hyperframe-editor/queue";
import { handleJob } from "./dispatch.js";

export async function runConsumerLoop(consumerName: string): Promise<() => Promise<void>> {
  let running = true;
  let inFlight: Promise<void> | null = null;

  const tick = async () => {
    while (running) {
      const batch = await readJobs({ consumerName, blockMs: 5_000, count: 1 });
      for (const { streamId, job } of batch) {
        try {
          await handleJob(job);
          await ackJob(streamId);
        } catch (e) {
          console.error(`[worker] job ${job.jobId} failed`, e);
          // Leave un-acked. XPENDING will reveal it; a separate reaper script
          // claims and retries / dead-letters after a TTL (Phase 2 work).
        }
      }
    }
  };

  inFlight = tick();

  return async () => {
    running = false;
    await inFlight;
  };
}

export type { QueuedJob };
