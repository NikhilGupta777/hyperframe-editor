/**
 * /api/render — delegates to Gemini agent (no Redis required).
 */
import { Router, type IRouter } from "express";
import { z } from "zod";
import { readJson } from "../lib/api-helpers";
import { startAgentTurn } from "../lib/agent-bus";

const router: IRouter = Router();

const RenderBody = z.object({
  projectId: z.string(),
  prompt: z.string().min(3),
  presetId: z.string().default("tiktok-hook"),
  kind: z.enum(["compose", "tweak", "edit_source"]).default("compose"),
});

// POST /api/render — delegates to Gemini agent
router.post("/render", async (req, res) => {
  const parsed = await readJson(req, res, RenderBody);
  if (!parsed) return;

  const agentKind = parsed.kind === "compose" ? "compose" : "tweak";
  const turnId = `t-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  startAgentTurn(turnId, {
    projectId: parsed.projectId,
    prompt: parsed.prompt,
    kind: agentKind,
    presetId: parsed.presetId ?? "tiktok-hook",
  });

  return res.json({ jobId: turnId });
});

// GET /api/render/:id/stream — redirect to gemini agent stream
router.get("/render/:id/stream", (req, res) =>
  res.redirect(307, `/api/gemini/agent/${req.params.id}/stream`),
);

// POST /api/jobs/:id/cancel
router.post("/jobs/:id/cancel", (_req, res) => res.json({ ok: true }));

// GET /api/jobs/:id
router.get("/jobs/:id", (_req, res) => res.status(404).json({ error: "job not found" }));

export default router;
