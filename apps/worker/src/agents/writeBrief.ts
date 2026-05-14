import type { Preset } from "@hyperframe-editor/core";
import { vertex } from "@hyperframe-editor/providers";

export interface BriefRequest {
  prompt: string;
  preset: Preset;
}
export interface Brief {
  title: string;
  /** A 2-3 sentence framing the planner uses to lay out beats. */
  summary: string;
  /** Hard mandates extracted from the user prompt (e.g. "in Hindi", "no music"). */
  mandates: string[];
}

const SCHEMA = {
  type: "object",
  required: ["title", "summary", "mandates"],
  properties: {
    title: { type: "string" },
    summary: { type: "string" },
    mandates: { type: "array", items: { type: "string" } },
  },
};

export async function writeBrief(req: BriefRequest): Promise<Brief> {
  const system = `You are a video director. Read a user's brief and the active preset; produce a concise creative brief as STRICT JSON. No markdown, no commentary.`;
  const userMsg = JSON.stringify({
    userPrompt: req.prompt,
    preset: {
      id: req.preset.id,
      label: req.preset.label,
      canvas: req.preset.canvas,
      palette: req.preset.palette,
      guardrails: req.preset.guardrails,
    },
  });

  // If Vertex isn't configured (smoke tests), fall back to a deterministic stub
  // that still satisfies the contract, so downstream code stays exercised.
  if (!process.env.GOOGLE_CLOUD_PROJECT && !process.env.VERTEX_PROJECT) {
    return {
      title: deriveTitle(req.prompt),
      summary: req.prompt.slice(0, 240),
      mandates: deriveMandates(req.prompt),
    };
  }

  const r = await vertex.generateText({
    model: "reasoning",
    system,
    messages: [{ role: "user", content: userMsg }],
    temperature: 0.4,
    jsonSchema: SCHEMA,
  });
  const parsed = (r.parsed ?? JSON.parse(r.text)) as Brief;
  return {
    title: parsed.title,
    summary: parsed.summary,
    mandates: parsed.mandates ?? [],
  };
}

function deriveTitle(prompt: string): string {
  const first = prompt.split(/[.!?\n]/)[0]?.trim() ?? prompt.slice(0, 60);
  return first.length > 60 ? first.slice(0, 57) + "…" : first;
}

function deriveMandates(prompt: string): string[] {
  const out: string[] = [];
  if (/hindi|devanagari/i.test(prompt)) out.push("language:hindi");
  if (/no\s+music/i.test(prompt)) out.push("audio:no-music");
  if (/captions?/i.test(prompt)) out.push("require:captions");
  return out;
}
