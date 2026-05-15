/**
 * Vertex AI provider — Gemini 3.1 Pro for reasoning, audio, video; Nano Banana Pro
 * (`gemini-3-pro-image`) and Imagen 4 fast for image generation.
 *
 * Uses the unified @google/genai SDK in Vertex mode. Auth is via Application Default
 * Credentials (GOOGLE_APPLICATION_CREDENTIALS pointing at a service-account JSON, or
 * gcloud ADC for local dev).
 *
 * Models we route to:
 *   - gemini-3.1-pro             reasoning, transcription, video understanding
 *   - gemini-2.5-flash           cheap intent classification
 *   - gemini-3-pro-image          high-quality image gen (Nano Banana Pro)
 *   - imagen-4.0-fast-generate-001  cheap image gen
 *
 * NOTE on @google/genai availability: the SDK is small and stable. If installation
 * fails on first install, fall back to "@google-cloud/vertexai" which has the
 * same auth model — see `vertex-fallback.ts` (TODO).
 */
import { GoogleGenAI, type Content, type Part } from "@google/genai";

let cached: GoogleGenAI | null = null;

export interface VertexConfig {
  project: string;
  location: string;
}

export function configFromEnv(): VertexConfig {
  const project =
    process.env.GOOGLE_CLOUD_PROJECT ??
    process.env.VERTEX_PROJECT ??
    "";
  const location =
    process.env.GOOGLE_CLOUD_LOCATION ??
    process.env.VERTEX_LOCATION ??
    "us-central1";
  if (!project) throw new Error("GOOGLE_CLOUD_PROJECT / VERTEX_PROJECT not set");
  return { project, location };
}

export function getClient(): GoogleGenAI {
  if (cached) return cached;
  const cfg = configFromEnv();
  cached = new GoogleGenAI({
    vertexai: true,
    project: cfg.project,
    location: cfg.location,
  });
  return cached;
}

export const MODELS = {
  reasoning: "gemini-3.1-pro",
  cheap: "gemini-2.5-flash",
  imageHQ: "gemini-3-pro-image",
  imageFast: "imagen-4.0-fast-generate-001",
} as const;

// ---------------------------------------------------------------------------
// Text generation (with optional structured-output enforcement via JSON schema)
// ---------------------------------------------------------------------------

export interface GenerateTextRequest {
  model?: keyof typeof MODELS | string;
  system?: string;
  /**
   * `messages` is the conversation. For the lint-and-self-heal loop we append
   * the previous assistant output and a user message with the lint errors.
   */
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  temperature?: number;
  maxOutputTokens?: number;
  /** If set, forces JSON output and returns {parsed} alongside the raw text. */
  jsonSchema?: Record<string, unknown>;
}

export interface GenerateTextResponse {
  text: string;
  parsed?: unknown;
  tokensIn: number;
  tokensOut: number;
  finishReason?: string;
}

export async function generateText(req: GenerateTextRequest): Promise<GenerateTextResponse> {
  const client = getClient();
  const model = (MODELS as Record<string, string>)[req.model ?? "reasoning"] ?? req.model ?? MODELS.reasoning;

  const contents: Content[] = [];
  for (const m of req.messages) {
    contents.push({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content } as Part],
    });
  }

  const result = await client.models.generateContent({
    model,
    contents,
    config: {
      systemInstruction: req.system,
      temperature: req.temperature ?? 0.7,
      maxOutputTokens: req.maxOutputTokens,
      ...(req.jsonSchema
        ? {
            responseMimeType: "application/json",
            responseSchema: req.jsonSchema as never,
          }
        : {}),
    },
  });

  const text = result.text ?? "";
  const usage = result.usageMetadata;
  let parsed: unknown;
  if (req.jsonSchema && text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      // Surface the parse failure to the caller so it can self-heal.
    }
  }
  return {
    text,
    parsed,
    tokensIn: usage?.promptTokenCount ?? 0,
    tokensOut: usage?.candidatesTokenCount ?? 0,
    finishReason: result.candidates?.[0]?.finishReason,
  };
}

// ---------------------------------------------------------------------------
// Image generation
// ---------------------------------------------------------------------------

export interface GenerateImageRequest {
  prompt: string;
  /** Aspect ratio, e.g. "1:1", "16:9", "9:16", "3:4", "4:3". */
  aspectRatio?: string;
  /** "fast" for Imagen 4 fast, "hq" for Nano Banana Pro. Default "fast". */
  quality?: "fast" | "hq";
  negativePrompt?: string;
  /** N-image batch (Imagen supports 1..4). Default 1. */
  count?: number;
}

export interface GeneratedImage {
  bytes: Buffer;
  mimeType: string;
}

export async function generateImage(req: GenerateImageRequest): Promise<GeneratedImage[]> {
  const client = getClient();
  const model = req.quality === "hq" ? MODELS.imageHQ : MODELS.imageFast;
  const count = Math.max(1, Math.min(req.count ?? 1, 4));

  const result = await client.models.generateImages({
    model,
    prompt: req.prompt,
    config: {
      numberOfImages: count,
      aspectRatio: req.aspectRatio,
      negativePrompt: req.negativePrompt,
    },
  });

  const images: GeneratedImage[] = [];
  for (const g of result.generatedImages ?? []) {
    const data = g.image?.imageBytes;
    if (!data) continue;
    const bytes = Buffer.from(data, "base64");
    images.push({ bytes, mimeType: g.image?.mimeType ?? "image/png" });
  }
  return images;
}

// ---------------------------------------------------------------------------
// Audio understanding (transcription + diarization, the long-video pattern)
// ---------------------------------------------------------------------------

export interface TranscribeRequest {
  /** Either inline bytes or a gs://... URI. */
  audio: { bytes: Buffer; mimeType: string } | { uri: string; mimeType: string };
  language?: string;
  /** If true, ask for speaker diarization; if false, skip it (cheaper). */
  withSpeakers?: boolean;
}

const TRANSCRIPT_SCHEMA = {
  type: "object",
  required: ["language", "segments"],
  properties: {
    language: { type: "string" },
    segments: {
      type: "array",
      items: {
        type: "object",
        required: ["start", "end", "text"],
        properties: {
          start: { type: "number" },
          end: { type: "number" },
          text: { type: "string" },
          speaker: { type: "string" },
        },
      },
    },
  },
};

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
  speaker?: string;
}
export interface TranscribeResponse {
  language: string;
  segments: TranscriptSegment[];
  /** Token usage for cost ledger; 0/0 when the SDK didn't surface it. */
  tokensIn: number;
  tokensOut: number;
}

export async function transcribe(req: TranscribeRequest): Promise<TranscribeResponse> {
  const client = getClient();
  const audioPart: Part =
    "bytes" in req.audio
      ? {
          inlineData: {
            mimeType: req.audio.mimeType,
            data: req.audio.bytes.toString("base64"),
          },
        }
      : { fileData: { fileUri: req.audio.uri, mimeType: req.audio.mimeType } };

  const system = `You are an audio transcriber. Output STRICT JSON matching the supplied schema. Each segment must have start (sec), end (sec), text. ${
    req.withSpeakers
      ? "Add a speaker label per segment (e.g. S0, S1) using consistent identifiers across the file."
      : "Omit speaker labels."
  }${req.language ? ` The audio is in ${req.language}.` : ""}`;

  const result = await client.models.generateContent({
    model: MODELS.reasoning,
    contents: [
      {
        role: "user",
        parts: [
          { text: "Transcribe this audio with word-level segmentation." },
          audioPart,
        ],
      },
    ],
    config: {
      systemInstruction: system,
      temperature: 0.1,
      responseMimeType: "application/json",
      responseSchema: TRANSCRIPT_SCHEMA as never,
    },
  });

  const text = result.text ?? "{}";
  const usage = result.usageMetadata;
  const parsed = JSON.parse(text) as Pick<TranscribeResponse, "language" | "segments">;
  return {
    language: parsed.language,
    segments: parsed.segments,
    tokensIn: usage?.promptTokenCount ?? 0,
    tokensOut: usage?.candidatesTokenCount ?? 0,
  };
}
