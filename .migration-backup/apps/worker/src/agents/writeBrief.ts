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

/**
 * Token-usage report from the underlying LLM call, or null when the agent ran
 * the deterministic offline path (no spend to record).
 */
export interface AgentUsage {
  model: "gemini-3.1-pro-preview" | "gemini-2.5-flash";
  tokensIn: number;
  tokensOut: number;
}
export interface BriefResult {
  brief: Brief;
  usage: AgentUsage | null;
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

export async function writeBrief(req: BriefRequest): Promise<BriefResult> {
  const system = `You are a creative video director known for visually stunning, dynamic content. Read a user's brief and the active preset; produce a concise creative brief as STRICT JSON. The brief should inspire a visually rich, multi-scene video with varied pacing, compelling narration, and cinematic imagery. No markdown, no commentary.`;
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
  // In production we REFUSE to return canned data unless WORKER_OFFLINE_STUBS=1
  // is explicitly set — loud failure > silent fakery.
  if (!process.env.GOOGLE_CLOUD_PROJECT && !process.env.VERTEX_PROJECT) {
    if (process.env.WORKER_OFFLINE_STUBS !== "1") {
      throw new Error(
        "Vertex AI is not configured (GOOGLE_CLOUD_PROJECT / VERTEX_PROJECT missing) " +
          "and WORKER_OFFLINE_STUBS is not set. Refusing to return canned data in production. " +
          "Set WORKER_OFFLINE_STUBS=1 for offline testing.",
      );
    }
    return {
      brief: {
        title: deriveTitle(req.prompt),
        summary: req.prompt.slice(0, 240),
        mandates: deriveMandates(req.prompt),
      },
      usage: null,
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
    brief: {
      title: parsed.title,
      summary: parsed.summary,
      mandates: parsed.mandates ?? [],
    },
    usage: { model: "gemini-3.1-pro-preview", tokensIn: r.tokensIn, tokensOut: r.tokensOut },
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
