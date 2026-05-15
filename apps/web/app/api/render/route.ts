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
 * Required infra: Redis. Earlier waves silently fell through to a synthetic
 * "mock-stream" when REDIS_URL was unset — which made it possible to ship a
 * deploy where the editor showed canned events for nonexistent renders. That
 * mock has been removed: a missing REDIS_URL now returns a hard 503 so the
 * configuration error surfaces instead of being papered over.
 */
export async function POST(req: Request) {
  if (!process.env.REDIS_URL) {
    return NextResponse.json(
      {
        error:
          "Render queue is not configured. Set REDIS_URL on the web deployment and ensure a worker is running against the same Redis.",
      },
      { status: 503 },
    );
  }

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

  const { enqueueJob } = await import("@hyperframe-editor/queue");
  await enqueueJob(job);

  return NextResponse.json({ jobId });
}
