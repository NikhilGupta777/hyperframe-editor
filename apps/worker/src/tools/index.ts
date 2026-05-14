/**
 * Worker-side tool dispatcher. Maps the tool manifest in
 * @hyperframe-editor/core/tools to typed implementations the orchestrator can
 * invoke either programmatically (current) or via Vertex function-calling
 * (Phase 1.5).
 */
import { z } from "zod";
import { extractAudio, probe, silenceDetect } from "@hyperframe-editor/ffmpeg";
import { pixabay, unsplash, freepik, vertex } from "@hyperframe-editor/providers";
import type { TOOL_MANIFEST } from "@hyperframe-editor/core";

export interface ToolContext {
  workDir: string;
  projectId: string;
}

const NotImplemented = (name: string) => async () => {
  throw new Error(`tool not implemented yet: ${name}`);
};

/**
 * Tool implementations. Each function takes context + parsed input and returns
 * unknown; the orchestrator validates output against the manifest's schema
 * before publishing it as a `tool` SSE event.
 */
export const TOOL_IMPLS: Record<string, (ctx: ToolContext, input: unknown) => Promise<unknown>> = {
  probe_media: async (ctx, input) => {
    const { sourceUri } = z.object({ sourceUri: z.string() }).parse(input);
    return probe(sourceUri);
  },
  extract_audio: async (ctx, input) => {
    const { sourceUri, output } = z
      .object({ sourceUri: z.string(), output: z.string() })
      .parse(input);
    await extractAudio(sourceUri, output);
    return { output };
  },
  silence_segments: async (ctx, input) => {
    const { sourceUri, noiseDb, minDurationSec } = z
      .object({
        sourceUri: z.string(),
        noiseDb: z.number().default(-30),
        minDurationSec: z.number().default(0.5),
      })
      .parse(input);
    return silenceDetect(sourceUri, noiseDb, minDurationSec);
  },
  search_pixabay: async (_ctx, input) => {
    const args = z
      .object({
        query: z.string(),
        kind: z.enum(["image", "video"]).default("image"),
        perPage: z.number().int().min(1).max(50).default(20),
        orientation: z.enum(["any", "horizontal", "vertical", "square"]).default("any"),
      })
      .parse(input);
    return { hits: await pixabay.search(args) };
  },
  search_unsplash: async (_ctx, input) => {
    const args = z
      .object({
        query: z.string(),
        kind: z.enum(["image", "video"]).default("image"),
        perPage: z.number().int().min(1).max(30).default(20),
        orientation: z.enum(["any", "horizontal", "vertical", "square"]).default("any"),
      })
      .parse(input);
    return { hits: await unsplash.search(args) };
  },
  search_freepik: async (_ctx, input) => {
    const args = z
      .object({
        query: z.string(),
        kind: z.enum(["image", "video"]).default("image"),
        perPage: z.number().int().min(1).max(50).default(20),
        apiKey: z.string(),
      })
      .parse(input);
    return { hits: await freepik.search(args) };
  },
  gen_image: async (_ctx, input) => {
    const args = z
      .object({
        prompt: z.string(),
        aspectRatio: z.string().optional(),
        quality: z.enum(["fast", "hq"]).default("fast"),
        count: z.number().int().min(1).max(4).default(1),
      })
      .parse(input);
    const imgs = await vertex.generateImage(args);
    // We never return raw bytes through the tool — only sizes + the local path
    // the caller would have written to. The orchestrator's acquireAssets handles
    // disk I/O.
    return { images: imgs.map((i) => ({ mimeType: i.mimeType, byteSize: i.bytes.length })) };
  },
  // The rest of the manifest is wired in subsequent phases.
  transcribe: NotImplemented("transcribe"),
  summarize_segment: NotImplemented("summarize_segment"),
  detect_scenes: NotImplemented("detect_scenes"),
  set_composition_meta: NotImplemented("set_composition_meta"),
  add_scene: NotImplemented("add_scene"),
  add_clip: NotImplemented("add_clip"),
  move_clip: NotImplemented("move_clip"),
  trim_clip: NotImplemented("trim_clip"),
  set_track_order: NotImplemented("set_track_order"),
  apply_transition: NotImplemented("apply_transition"),
  add_caption_block: NotImplemented("add_caption_block"),
  add_lower_third: NotImplemented("add_lower_third"),
  add_logo_bug: NotImplemented("add_logo_bug"),
  silence_cut: NotImplemented("silence_cut"),
  auto_caption: NotImplemented("auto_caption"),
  color_grade_preset: NotImplemented("color_grade_preset"),
  normalize_loudness: NotImplemented("normalize_loudness"),
  duck_music_under_voice: NotImplemented("duck_music_under_voice"),
  ken_burns: NotImplemented("ken_burns"),
  reframe_to_aspect: NotImplemented("reframe_to_aspect"),
  lint_composition: NotImplemented("lint_composition"),
  dry_render: NotImplemented("dry_render"),
  cost_estimate: NotImplemented("cost_estimate"),
  render: NotImplemented("render"),
  cancel_render: NotImplemented("cancel_render"),
};

export type ToolName = keyof typeof TOOL_IMPLS;

export function listTools(): ToolName[] {
  return Object.keys(TOOL_IMPLS) as ToolName[];
}

/** Re-export the manifest type so apps/worker doesn't double-import. */
export type ToolManifest = typeof TOOL_MANIFEST;
