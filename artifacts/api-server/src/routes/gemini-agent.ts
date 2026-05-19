import { Router, type IRouter } from "express";
import { z } from "zod";
import { readJson } from "../lib/api-helpers";
import { startAgentTurn, turnEvents, turnDone } from "../lib/agent-bus";

const router: IRouter = Router();

const GeminiAgentBody = z.object({
  projectId: z.string().min(1),
  prompt: z.string().min(1),
  kind: z.enum(["compose", "tweak"]).default("compose"),
  presetId: z.string().default("tiktok-hook"),
});

// POST /api/gemini/agent/turn
router.post("/gemini/agent/turn", async (req, res) => {
  const parsed = await readJson(req, res, GeminiAgentBody);
  if (!parsed) return;

  const turnId = `t-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  startAgentTurn(turnId, parsed);
  res.json({ turnId, jobId: turnId });
});

// GET /api/gemini/agent/:turnId/stream — SSE
router.get("/gemini/agent/:turnId/stream", (req, res) => {
  const { turnId } = req.params;

  if (!turnEvents.has(turnId)) {
    return res.status(404).json({ error: "turn not found" });
  }

  res.setHeader("content-type", "text/event-stream");
  res.setHeader("cache-control", "no-cache, no-transform");
  res.setHeader("connection", "keep-alive");
  res.setHeader("x-accel-buffering", "no");
  res.flushHeaders();

  let cursor = 0;
  let closed = false;

  const heartbeat = setInterval(() => { if (!closed) res.write(": hb\n\n"); }, 20_000);

  const poll = setInterval(() => {
    if (closed) return;
    const events = turnEvents.get(turnId) ?? [];
    while (cursor < events.length) {
      res.write(`data: ${JSON.stringify(events[cursor])}\n\n`);
      cursor++;
    }
    if (turnDone.get(turnId) && cursor >= (turnEvents.get(turnId)?.length ?? 0)) {
      clearInterval(poll);
      clearInterval(heartbeat);
      if (!closed) { res.end(); closed = true; }
    }
  }, 100);

  req.on("close", () => {
    closed = true;
    clearInterval(poll);
    clearInterval(heartbeat);
  });
});

export default router;
