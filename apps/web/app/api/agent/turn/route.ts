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
  presetId: z.string().default("youtube-essay"),
  sourceUri: z.string().min(1).optional(),
  sources: z
    .array(
      z.object({
        id: z.string().min(1),
        uri: z.string().min(1),
        language: z.string().optional(),
      }),
    )
    .optional(),
  targetDurationSec: z.number().positive().optional(),
  language: z.string().optional(),
  captions: z.boolean().optional(),
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
 *
 * Like /api/render, this route returns a hard 503 when REDIS_URL is unset. The
 * mock fallback has been removed.
 */
export async function POST(req: Request) {
  if (!process.env.REDIS_URL) {
    return NextResponse.json(
      {
        error:
          "Agent queue is not configured. Set REDIS_URL on the web deployment and ensure a worker is running against the same Redis.",
      },
      { status: 503 },
    );
  }

  const parsed = await readJson(req, Body);
  if (parsed instanceof NextResponse) return parsed;

  const jobId = randomUUID();
  const inputKind = parsed.kind ?? "build";
  // The worker uses underscored names ("edit_source") on the queue while the
  // editor's chat UI sends hyphenated ("edit-source"). Normalise here.
  const kind = inputKind === "edit-source" ? "edit_source" : inputKind;
  const presetId = parsed.presetId ?? "youtube-essay";
  const payload =
    kind === "edit_source"
      ? {
          direction: parsed.prompt,
          presetId,
          ...(parsed.sourceUri ? { sourceUri: parsed.sourceUri } : {}),
          ...(parsed.sources ? { sources: parsed.sources } : {}),
          targetDurationSec: parsed.targetDurationSec ?? 600,
          ...(parsed.language ? { language: parsed.language } : {}),
          ...(parsed.captions !== undefined ? { captions: parsed.captions } : {}),
        }
      : { prompt: parsed.prompt, presetId };

  if (kind === "edit_source" && !parsed.sourceUri && !parsed.sources?.length) {
    return NextResponse.json(
      { error: "edit-source requires sourceUri or sources" },
      { status: 400 },
    );
  }

  const job = {
    jobId,
    kind,
    projectId: parsed.projectId,
    payload,
  };

  const { enqueueJob } = await import("@hyperframe-editor/queue");
  await enqueueJob(job);

  return NextResponse.json({ jobId });
}
