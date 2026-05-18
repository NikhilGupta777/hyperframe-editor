import { Router, type IRouter } from "express";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { readJson } from "../lib/api-helpers";

const router: IRouter = Router();

const RenderBody = z.object({
  projectId: z.string(),
  prompt: z.string().min(3),
  presetId: z.string().default("youtube-essay"),
  kind: z.enum(["compose", "tweak", "edit_source"]).default("compose"),
  sourceUri: z.string().min(1).optional(),
  sources: z.array(z.object({
    id: z.string().min(1),
    uri: z.string().min(1),
    language: z.string().optional(),
  })).optional(),
  targetDurationSec: z.number().positive().optional(),
  language: z.string().optional(),
  captions: z.boolean().optional(),
});

// POST /api/render
router.post("/render", async (req, res) => {
  if (!process.env.REDIS_URL) {
    return res.status(503).json({
      error:
        "Render queue is not configured. Set REDIS_URL on the deployment and ensure a worker is running against the same Redis.",
    });
  }

  const parsed = await readJson(req, res, RenderBody);
  if (!parsed) return;

  if (parsed.kind === "edit_source" && !parsed.sourceUri && !parsed.sources?.length) {
    return res.status(400).json({ error: "edit_source requires sourceUri or sources" });
  }

  const jobId = randomUUID();
  const payload =
    parsed.kind === "edit_source"
      ? {
          direction: parsed.prompt,
          presetId: parsed.presetId,
          ...(parsed.sourceUri ? { sourceUri: parsed.sourceUri } : {}),
          ...(parsed.sources ? { sources: parsed.sources } : {}),
          targetDurationSec: parsed.targetDurationSec ?? 600,
          ...(parsed.language ? { language: parsed.language } : {}),
          ...(parsed.captions !== undefined ? { captions: parsed.captions } : {}),
        }
      : { prompt: parsed.prompt, presetId: parsed.presetId };

  try {
    // @ts-ignore
    const { enqueueJob } = await import("@hyperframe-editor/queue");
    await enqueueJob({ jobId, kind: parsed.kind, projectId: parsed.projectId, payload });
  } catch {
    return res.status(503).json({ error: "Failed to enqueue job. Ensure REDIS_URL is configured." });
  }

  res.json({ jobId });
});

// GET /api/render/:id/stream — SSE bridge
router.get("/render/:id/stream", async (req, res) => {
  const { id } = req.params;

  if (!process.env.REDIS_URL) {
    return res.status(503).json({
      error: "REDIS_URL not configured; SSE bridge requires a real worker queue",
    });
  }

  res.setHeader("content-type", "text/event-stream");
  res.setHeader("cache-control", "no-cache, no-transform");
  res.setHeader("connection", "keep-alive");
  res.setHeader("x-accel-buffering", "no");
  res.flushHeaders();

  let closed = false;
  let unsub: (() => Promise<void>) | null = null;

  const heartbeat = setInterval(() => {
    if (!closed) res.write(": hb\n\n");
  }, 25_000);

  const cleanup = async () => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    if (unsub) {
      try { await unsub(); } catch { /* ignore */ }
      unsub = null;
    }
    res.end();
  };

  req.on("close", () => { void cleanup(); });

  try {
    // @ts-ignore
    const { subscribeToJob } = await import("@hyperframe-editor/queue");
    unsub = await subscribeToJob(id, (e: unknown) => {
      if (closed) return;
      res.write(`data: ${JSON.stringify(e)}\n\n`);
      const ev = e as { type?: string };
      if (ev.type === "done" || ev.type === "error") void cleanup();
    });
  } catch {
    res.write(`data: ${JSON.stringify({ type: "error", message: "Failed to subscribe to job stream" })}\n\n`);
    void cleanup();
  }
});

// POST /api/jobs/:id/cancel
router.post("/jobs/:id/cancel", async (req, res) => {
  void req.params.id;
  res.json({ ok: true });
});

// GET /api/jobs/:id
router.get("/jobs/:id", async (req, res) => {
  res.status(404).json({ error: "job not found" });
});

export default router;
