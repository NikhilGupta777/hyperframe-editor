import type { Beat, Preset } from "@hyperframe-editor/core";
import { vertex } from "@hyperframe-editor/providers";
import type { Brief, AgentUsage } from "./writeBrief.js";

export interface PlanRequest {
  brief: Brief;
  preset: Preset;
}

export interface PlanResult {
  beats: Beat[];
  usage: AgentUsage | null;
}

const SCHEMA = {
  type: "object",
  required: ["beats"],
  properties: {
    beats: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "narration", "duration", "blocks"],
        properties: {
          id: { type: "string" },
          narration: { type: "string" },
          duration: { type: "number" },
          blocks: { type: "array", items: { type: "string" } },
          assetCues: {
            type: "array",
            items: {
              type: "object",
              required: ["slot", "query", "kind"],
              properties: {
                slot: { type: "string" },
                query: { type: "string" },
                kind: { type: "string", enum: ["image", "video", "audio"] },
              },
            },
          },
        },
      },
    },
  },
};

export async function planBeats(req: PlanRequest): Promise<PlanResult> {
  // Deterministic stub when Vertex isn't configured: sample one beat per slot
  // at the slot's mid-duration. Beats now also synthesise asset cues from the
  // brief title so the offline path still exercises asset acquisition.
  // In production we REFUSE to return canned data unless WORKER_OFFLINE_STUBS=1.
  if (!process.env.GOOGLE_CLOUD_PROJECT && !process.env.VERTEX_PROJECT) {
    if (process.env.WORKER_OFFLINE_STUBS !== "1") {
      throw new Error(
        "Vertex AI is not configured and WORKER_OFFLINE_STUBS is not set. " +
          "Refusing to return canned beats in production.",
      );
    }
    const beats = req.preset.skeleton.map<Beat>((slot, i) => ({
      id: slot.id,
      narration:
        i === 0
          ? req.brief.title
          : i === req.preset.skeleton.length - 1
            ? "Subscribe"
            : req.brief.summary,
      duration: midOf(slot.durRange[0], slot.durRange[1]),
      blocks: slot.blocks.slice(0, 1),
      assetCues:
        i === 0 || i === req.preset.skeleton.length - 1
          ? []
          : [
              {
                slot: "background",
                query: req.brief.title.split(/[.\n,]/)[0]?.trim() || "abstract",
                kind: "image",
              },
            ],
    }));
    return { beats, usage: null };
  }

  const system = `You are a professional video director creating a dynamic, visually rich video. Given a brief and a preset's beat skeleton, return a list of beats as STRICT JSON.

Rules:
- Each beat's duration must lie inside its slot's durRange.
- Use MULTIPLE block names from the slot's available blocks to create layered compositions (e.g. a KenBurnsImage background with a LowerThird overlay).
- Every beat MUST have at least one assetCue with a descriptive, specific search query for stock media.
- For body/content beats, include BOTH image and video asset cues for visual variety.
- Asset queries should be specific and cinematic (e.g. "aerial drone shot of city skyline at sunset" not just "city").
- Narration text should be compelling and concise — this is what appears on screen.
- Create at least 5-8 beats for videos over 60 seconds to maintain visual variety.
- Vary the blocks across beats — don't repeat the same block pattern.

Output JSON only, no commentary.`;
  const userMsg = JSON.stringify({
    brief: req.brief,
    skeleton: req.preset.skeleton,
    guardrails: req.preset.guardrails,
  });

  const r = await vertex.generateText({
    model: "reasoning",
    system,
    messages: [{ role: "user", content: userMsg }],
    temperature: 0.6,
    jsonSchema: SCHEMA,
  });
  const parsed = (r.parsed ?? JSON.parse(r.text)) as { beats: Beat[] };
  const beats = parsed.beats.map((b, i) => ({
    ...b,
    id: b.id || req.preset.skeleton[i]?.id || `beat-${i}`,
    blocks: b.blocks?.length ? b.blocks : req.preset.skeleton[i]?.blocks.slice(0, 1) ?? [],
    duration: clamp(b.duration, req.preset.skeleton[i]?.durRange ?? [1, 60]),
    assetCues: b.assetCues ?? [],
  }));
  return {
    beats,
    usage: { model: "gemini-3.1-pro-preview", tokensIn: r.tokensIn, tokensOut: r.tokensOut },
  };
}

function midOf(lo: number, hi: number): number {
  return Number(((lo + hi) / 2).toFixed(2));
}
function clamp(v: number, range: [number, number]): number {
  return Math.max(range[0], Math.min(range[1], v));
}
