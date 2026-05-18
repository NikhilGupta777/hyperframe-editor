import { Router, type IRouter } from "express";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { readJson } from "../lib/api-helpers";

const router: IRouter = Router();

const AgentTurnBody = z.object({
  projectId: z.string(),
  prompt: z.string().min(1),
  kind: z.enum(["build", "tweak", "edit-source"]).default("build"),
  presetId: z.string().default("youtube-essay"),
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

// POST /api/agent/turn
router.post("/agent/turn", async (req, res) => {
  if (!process.env.REDIS_URL) {
    return res.status(503).json({
      error:
        "Agent queue is not configured. Set REDIS_URL on the deployment and ensure a worker is running against the same Redis.",
    });
  }

  const parsed = await readJson(req, res, AgentTurnBody);
  if (!parsed) return;

  const jobId = randomUUID();
  const inputKind = parsed.kind ?? "build";
  const kind = inputKind === "edit-source" ? "edit_source" : inputKind;
  const presetId = parsed.presetId ?? "youtube-essay";

  if (kind === "edit_source" && !parsed.sourceUri && !parsed.sources?.length) {
    return res.status(400).json({ error: "edit-source requires sourceUri or sources" });
  }

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

  try {
    // @ts-ignore
    const { enqueueJob } = await import("@hyperframe-editor/queue");
    await enqueueJob({ jobId, kind, projectId: parsed.projectId, payload });
  } catch {
    return res.status(503).json({ error: "Failed to enqueue job. Ensure REDIS_URL is configured." });
  }

  res.json({ jobId });
});

export default router;
