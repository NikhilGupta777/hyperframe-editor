import { NextResponse } from "next/server";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { readJson } from "@/lib/api";

export const runtime = "nodejs";

const Body = z.object({
  projectId: z.string(),
  prompt: z.string().min(1),
  /** Optional kind — "build" creates a new composition, "tweak" patches the existing one. */
  kind: z.enum(["build", "tweak", "edit-source"]).default("build"),
  presetId: z.string().default("tiktok-hook"),
});

/**
 * POST /api/agent/turn
 *
 * One chat turn. The browser sends a prompt; we enqueue a job (compose / tweak /
 * edit-source) and return its id so the chat panel can subscribe to the SSE
 * progress stream.
 *
 * The route does not stream by itself; it only enqueues. SSE is served by
 * /api/render/:id/stream which the chat client subscribes to as soon as it has
 * the jobId in hand. This keeps the route handler short-lived (good for Vercel)
 * and lets multiple browsers tail the same job.
 */
export async function POST(req: Request) {
  const parsed = await readJson(req, Body);
  if (parsed instanceof NextResponse) return parsed;

  const jobId = randomUUID();
  const inputKind = parsed.kind ?? "build";
  const kind = inputKind === "edit-source" ? "edit_source" : inputKind;
  const presetId = parsed.presetId ?? "tiktok-hook";
  const job = {
    jobId,
    kind,
    projectId: parsed.projectId,
    payload: { prompt: parsed.prompt, presetId },
  };

  if (process.env.REDIS_URL) {
    const { enqueueJob } = await import("@hyperframe-editor/queue");
    await enqueueJob(job);
  } else {
    const { mockEnqueue } = await import("../../render/mock-stream.js");
    mockEnqueue({ jobId, payload: { prompt: parsed.prompt, presetId } });
  }

  return NextResponse.json({ jobId });
}
