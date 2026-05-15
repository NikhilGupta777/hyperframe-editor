import { NextResponse } from "next/server";
import { z } from "zod";
import { randomUUID } from "node:crypto";

export const runtime = "nodejs";

const Body = z.object({
  projectId: z.string(),
  prompt: z.string().min(3),
  presetId: z.string().default("tiktok-hook"),
  /** Worker job kind. Default `compose` (the BUILD loop). */
  kind: z.enum(["compose", "tweak", "edit_source"]).default("compose"),
});

/**
 * POST /api/render — enqueue a worker job.
 *
 * Accepts compose / tweak / edit_source. The browser POSTs the prompt + preset;
 * we mint a jobId, push the job onto the Redis stream the worker consumes, and
 * return the jobId. The browser then subscribes to /api/render/:id/stream for
 * SSE progress.
 *
 * If REDIS_URL is unset (local dev with no infra), we degrade to an in-memory
 * mock so the editor UI still renders the SSE stream. The mock stream is a
 * compose-loop-shaped fake — running tweak/edit-source against the mock just
 * shows the same canned events because there's no real worker.
 */
export async function POST(req: Request) {
  const json = await req.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  const jobId = randomUUID();
  const job = {
    jobId,
    kind: parsed.data.kind,
    projectId: parsed.data.projectId,
    payload: { prompt: parsed.data.prompt, presetId: parsed.data.presetId },
  };

  if (process.env.REDIS_URL) {
    const { enqueueJob } = await import("@hyperframe-editor/queue");
    await enqueueJob(job);
  } else {
    // Degraded path: store the prompt in a process-local map so the SSE handler
    // can replay a synthetic stream. Useful for Vercel preview deploys without
    // backend infrastructure.
    const { mockEnqueue } = await import("./mock-stream.js");
    mockEnqueue(job);
  }

  return NextResponse.json({ jobId });
}
