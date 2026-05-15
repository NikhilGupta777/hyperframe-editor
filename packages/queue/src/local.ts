/**
 * In-process queue fallback for local development & Vercel preview deploys.
 *
 * When REDIS_URL is not set but the web app wants to work in "demo mode"
 * (create projects, view compositions, browse stock), the queue-dependent
 * routes (/api/render, /api/agent/turn, /api/render/:id/stream) return 503.
 *
 * This module provides a LOCAL_DEV escape hatch: if both the web app and
 * worker run in the same process (e.g. `pnpm dev` with a local worker
 * wrapper), events flow through an in-memory EventEmitter instead of Redis.
 *
 * Production ALWAYS uses real Redis — this is explicitly not for prod.
 */
import { EventEmitter } from "node:events";
import type { JobEvent, QueuedJob } from "./index.js";

const bus = new EventEmitter();
bus.setMaxListeners(100);

const jobQueue: QueuedJob[] = [];

export function localEnqueue(job: QueuedJob): void {
  jobQueue.push(job);
  bus.emit("job:new", job);
}

export function localPublish(jobId: string, evt: JobEvent): void {
  bus.emit(`job:${jobId}`, evt);
}

export function localSubscribe(
  jobId: string,
  onEvent: (e: JobEvent) => void,
): () => void {
  const handler = (e: JobEvent) => onEvent(e);
  bus.on(`job:${jobId}`, handler);
  return () => {
    bus.off(`job:${jobId}`, handler);
  };
}

export function localDrainOne(): QueuedJob | undefined {
  return jobQueue.shift();
}

export function localOnNewJob(handler: (job: QueuedJob) => void): () => void {
  bus.on("job:new", handler);
  return () => bus.off("job:new", handler);
}
