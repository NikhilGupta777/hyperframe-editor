import type { Beat, Preset } from "@hyperframe-editor/core";
import { vertex } from "@hyperframe-editor/providers";
import type { Brief } from "./writeBrief.js";

export interface PlanRequest {
  brief: Brief;
  preset: Preset;
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

export async function planBeats(req: PlanRequest): Promise<Beat[]> {
  // Deterministic stub when Vertex isn't configured: sample one beat per slot
  // at the slot's mid-duration.
  if (!process.env.GOOGLE_CLOUD_PROJECT && !process.env.VERTEX_PROJECT) {
    return req.preset.skeleton.map<Beat>((slot, i) => ({
      id: slot.id,
      narration: i === 0 ? req.brief.title : i === req.preset.skeleton.length - 1 ? "Subscribe" : req.brief.summary,
      duration: midOf(slot.durRange[0], slot.durRange[1]),
      blocks: slot.blocks.slice(0, 1),
      assetCues: [],
    }));
  }

  const system = `You are a video director. Given a brief and a preset's beat skeleton, return a list of beats as STRICT JSON. Each beat's duration must lie inside its slot's durRange. Use only block names listed for the slot. Output JSON only.`;
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
  return parsed.beats.map((b, i) => ({
    ...b,
    id: b.id || req.preset.skeleton[i]?.id || `beat-${i}`,
    blocks: b.blocks?.length ? b.blocks : req.preset.skeleton[i]?.blocks.slice(0, 1) ?? [],
    duration: clamp(b.duration, req.preset.skeleton[i]?.durRange ?? [1, 60]),
    assetCues: b.assetCues ?? [],
  }));
}

function midOf(lo: number, hi: number): number {
  return Number(((lo + hi) / 2).toFixed(2));
}
function clamp(v: number, range: [number, number]): number {
  return Math.max(range[0], Math.min(range[1], v));
}
