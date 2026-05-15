import { vertex } from "@hyperframe-editor/providers";
import type { EDL, EDLEntry } from "@hyperframe-editor/core";
import type { AgentUsage } from "./writeBrief.js";

export interface ProposeEDLResult {
  edl: EDL;
  usage: AgentUsage | null;
}

const SCHEMA = {
  type: "object",
  required: ["entries"],
  properties: {
    entries: {
      type: "array",
      items: {
        type: "object",
        required: ["sourceId", "in", "out"],
        properties: {
          sourceId: { type: "string" },
          in: { type: "number" },
          out: { type: "number" },
          layer: { type: "integer" },
          speed: { type: "number" },
        },
      },
    },
  },
};

export interface ProposeEDLRequest {
  /** Markdown packed transcript view (output of packTranscript). */
  packed: string;
  /** User direction (e.g. "make a 60s highlight that keeps the funniest takes"). */
  direction: string;
  /** Target duration in seconds. */
  targetDurationSec: number;
  /** Available source IDs the model is allowed to reference. */
  allowedSourceIds: string[];
}

export async function proposeEDL(req: ProposeEDLRequest): Promise<ProposeEDLResult> {
  // Offline-friendly stub: produce a single entry that grabs the start of the
  // first allowed source for the requested duration. Phase 1 uses this when
  // Vertex isn't configured so the editor still demonstrates the loop.
  if (!process.env.GOOGLE_CLOUD_PROJECT && !process.env.VERTEX_PROJECT) {
    const sourceId = req.allowedSourceIds[0] ?? "src-0";
    return {
      edl: {
        entries: [{ sourceId, in: 0, out: req.targetDurationSec, layer: 0, speed: 1 }],
      },
      usage: null,
    };
  }

  const system = `You are a video editor. Read a packed transcript view and produce an Edit Decision List as STRICT JSON.

Hard rules:
- Reference only sourceIds from the supplied allowedSourceIds.
- The total of (out - in) must be approximately the target duration (within 10%).
- Cuts must land on phrase boundaries from the transcript, never mid-word.
- Prefer keeping coherent thoughts together over short snippets.
- Output JSON only, no prose.`;

  const userMsg = JSON.stringify({
    direction: req.direction,
    targetDurationSec: req.targetDurationSec,
    allowedSourceIds: req.allowedSourceIds,
    packed: req.packed,
  });

  const r = await vertex.generateText({
    model: "reasoning",
    system,
    messages: [{ role: "user", content: userMsg }],
    temperature: 0.4,
    jsonSchema: SCHEMA,
  });
  const parsed = (r.parsed ?? JSON.parse(r.text)) as { entries: EDLEntry[] };
  return {
    edl: { entries: parsed.entries },
    usage: { model: "gemini-3.1-pro", tokensIn: r.tokensIn, tokensOut: r.tokensOut },
  };
}
