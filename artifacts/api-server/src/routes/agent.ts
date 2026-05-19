/**
 * /api/agent — delegates to Gemini agent (no Redis required).
 */
import { Router, type IRouter } from "express";
import { z } from "zod";
import { readJson } from "../lib/api-helpers";
import { startAgentTurn } from "../lib/agent-bus";

const router: IRouter = Router();

const AgentTurnBody = z.object({
  projectId: z.string(),
  prompt: z.string().min(1),
  kind: z.enum(["build", "tweak", "edit-source"]).default("build"),
  presetId: z.string().default("tiktok-hook"),
});

// POST /api/agent/turn — delegates to Gemini agent
router.post("/agent/turn", async (req, res) => {
  const parsed = await readJson(req, res, AgentTurnBody);
  if (!parsed) return;

  const agentKind = parsed.kind === "build" ? "compose" : "tweak";
  const turnId = `t-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  startAgentTurn(turnId, {
    projectId: parsed.projectId,
    prompt: parsed.prompt,
    kind: agentKind,
    presetId: parsed.presetId ?? "tiktok-hook",
  });

  return res.json({ jobId: turnId });
});

export default router;
