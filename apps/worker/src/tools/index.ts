/**
 * Worker-side tool dispatcher. Maps the tool manifest in
 * @hyperframe-editor/core/tools to typed implementations the orchestrator can
 * invoke either programmatically (current) or via Vertex function-calling
 * (Phase 1.5).
 */
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { extractAudio, loudnorm, probe, silenceDetect } from "@hyperframe-editor/ffmpeg";
import { pixabay, unsplash, freepik, vertex } from "@hyperframe-editor/providers";
import {
  CompositionSchema,
  getPreset,
  type Composition,
  type TOOL_MANIFEST,
} from "@hyperframe-editor/core";
import {
  addClip,
  moveClip,
  setCompositionMeta,
  setTrackOrder,
  trimClip,
} from "@hyperframe-editor/compose";
import { autoCaption } from "./autoCaption.js";
import { dryRender } from "./dryRender.js";
import { silenceCut } from "./silenceCut.js";
import { priceRender } from "../orchestrator/cost.js";
import { runRender } from "../render/runRender.js";

export interface ToolContext {
  workDir: string;
  projectId: string;
}

const TranscriptSegmentSchema = z.object({
  start: z.number().nonnegative(),
  end: z.number().nonnegative(),
  text: z.string(),
  speaker: z.string().optional(),
});

const CompositionInput = z.object({
  composition: CompositionSchema,
});

function parseComposition(input: unknown): Composition {
  return CompositionInput.parse(input).composition;
}

function blockClipInput(block: string) {
  return z
    .object({
      composition: CompositionSchema,
      start: z.number().nonnegative().optional(),
      duration: z.number().positive(),
      trackIndex: z.number().int().nonnegative().optional(),
      id: z.string().optional(),
      props: z.record(z.unknown()).default({}),
    })
    .transform((v) => ({
      composition: v.composition,
      start: v.start,
      trackIndex: v.trackIndex,
      clip: {
        id: v.id,
        kind: "block" as const,
        block,
        duration: v.duration,
        props: v.props,
      },
    }));
}

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
  transcribe: async (_ctx, input) => {
    const args = z
      .object({
        audioPath: z.string(),
        language: z.string().optional(),
        mimeType: z.string().default("audio/wav"),
        withSpeakers: z.boolean().default(true),
      })
      .parse(input);
    const bytes = await readFile(args.audioPath);
    const result = await vertex.transcribe({
      audio: { bytes, mimeType: args.mimeType },
      language: args.language,
      withSpeakers: args.withSpeakers,
    });
    return {
      language: result.language,
      segments: result.segments,
      usage: { tokensIn: result.tokensIn, tokensOut: result.tokensOut },
    };
  },
  summarize_segment: async (_ctx, input) => {
    const { text, maxWords } = z
      .object({ text: z.string(), maxWords: z.number().int().min(8).max(120).default(40) })
      .parse(input);
    if (!process.env.GOOGLE_CLOUD_PROJECT && !process.env.VERTEX_PROJECT) {
      const words = text.split(/\s+/).filter(Boolean).slice(0, maxWords);
      return { summary: words.join(" "), usage: { tokensIn: 0, tokensOut: 0 } };
    }
    const res = await vertex.generateText({
      model: "reasoning",
      temperature: 0.2,
      maxOutputTokens: 256,
      messages: [
        {
          role: "user",
          content: `Summarize this transcript segment in ${maxWords} words or fewer:\n\n${text}`,
        },
      ],
    });
    return {
      summary: res.text.trim(),
      usage: { tokensIn: res.tokensIn, tokensOut: res.tokensOut },
    };
  },
  detect_scenes: async (_ctx, input) => {
    const { sourceUri, everySec } = z
      .object({
        sourceUri: z.string(),
        everySec: z.number().positive().default(30),
      })
      .parse(input);
    const meta = await probe(sourceUri);
    const scenes = [];
    for (let start = 0; start < meta.durationSec; start += everySec) {
      scenes.push({
        start: Number(start.toFixed(3)),
        end: Number(Math.min(start + everySec, meta.durationSec).toFixed(3)),
        kind: "interval",
      });
    }
    return { scenes, durationSec: meta.durationSec };
  },
  set_composition_meta: async (_ctx, input) => {
    const args = z
      .object({
        composition: CompositionSchema,
        width: z.number().int().positive().optional(),
        height: z.number().int().positive().optional(),
        fps: z.number().int().positive().optional(),
        variables: z.record(z.unknown()).optional(),
      })
      .parse(input);
    return { composition: setCompositionMeta(args.composition, args) };
  },
  add_scene: async (_ctx, input) => {
    const args = blockClipInput("HookTitle").parse(input);
    return { composition: addClip(args.composition, args) };
  },
  add_clip: async (_ctx, input) => {
    const args = z
      .object({
        composition: CompositionSchema,
        start: z.number().nonnegative().optional(),
        trackIndex: z.number().int().nonnegative().optional(),
        clip: z.object({
          id: z.string().optional(),
          kind: z.enum(["video", "image", "audio", "text", "block"]),
          duration: z.number().positive(),
          block: z.string().optional(),
          assetId: z.string().optional(),
          playbackOffset: z.number().nonnegative().optional(),
          props: z.record(z.unknown()).optional(),
        }),
      })
      .parse(input);
    return { composition: addClip(args.composition, args) };
  },
  move_clip: async (_ctx, input) => {
    const args = z
      .object({
        composition: CompositionSchema,
        clipId: z.string(),
        start: z.number().nonnegative().optional(),
        trackIndex: z.number().int().nonnegative().optional(),
      })
      .parse(input);
    return { composition: moveClip(args.composition, args) };
  },
  trim_clip: async (_ctx, input) => {
    const args = z
      .object({
        composition: CompositionSchema,
        clipId: z.string(),
        duration: z.number().positive().optional(),
        playbackOffset: z.number().nonnegative().optional(),
      })
      .parse(input);
    return { composition: trimClip(args.composition, args) };
  },
  set_track_order: async (_ctx, input) => {
    const args = z
      .object({
        composition: CompositionSchema,
        trackIndex: z.number().int().nonnegative(),
        orderedClipIds: z.array(z.string()).min(1),
      })
      .parse(input);
    return { composition: setTrackOrder(args.composition, args) };
  },
  apply_transition: async (_ctx, input) => {
    const { composition, clipId, transition } = z
      .object({
        composition: CompositionSchema,
        clipId: z.string(),
        transition: z.object({
          type: z.enum(["crossfade", "wipe", "flash", "none"]).default("crossfade"),
          duration: z.number().positive().max(3).default(0.35),
        }),
      })
      .parse(input);
    const next = structuredClone(composition);
    const clip = next.clips.find((c) => c.id === clipId);
    if (!clip) throw new Error(`unknown clip: ${clipId}`);
    clip.props = { ...clip.props, transition };
    return { composition: CompositionSchema.parse(next) };
  },
  add_caption_block: async (_ctx, input) => {
    const args = blockClipInput("CaptionBlock").parse(input);
    return { composition: addClip(args.composition, args) };
  },
  add_lower_third: async (_ctx, input) => {
    const args = blockClipInput("LowerThird").parse(input);
    return { composition: addClip(args.composition, args) };
  },
  add_logo_bug: async (_ctx, input) => {
    const args = blockClipInput("LogoBug").parse(input);
    return { composition: addClip(args.composition, args) };
  },
  silence_cut: async (_ctx, input) =>
    silenceCut(
      z
        .object({
          sourceUri: z.string(),
          noiseDb: z.number().optional(),
          minDurationSec: z.number().optional(),
          pad: z.number().optional(),
        })
        .parse(input),
    ),
  auto_caption: async (_ctx, input) => {
    const args = z
      .object({
        segments: z.array(TranscriptSegmentSchema),
        style: z
          .object({
            variant: z.enum(["tiktok", "subtitle"]).default("tiktok"),
            maxChars: z.number().int().positive().optional(),
          })
          .default({ variant: "tiktok" }),
        outputSrtPath: z.string().optional(),
      })
      .parse(input);
    return autoCaption(args.segments, args.style, args.outputSrtPath);
  },
  color_grade_preset: async (_ctx, input) => {
    const { composition, clipId, preset } = z
      .object({
        composition: CompositionSchema,
        clipId: z.string(),
        preset: z.enum(["natural", "cinematic", "warm-devotional", "high-contrast"]),
      })
      .parse(input);
    const next = structuredClone(composition);
    const clip = next.clips.find((c) => c.id === clipId);
    if (!clip) throw new Error(`unknown clip: ${clipId}`);
    clip.props = { ...clip.props, colorGrade: preset };
    return { composition: CompositionSchema.parse(next) };
  },
  normalize_loudness: async (_ctx, input) => {
    const { sourceUri, output, lufsTarget } = z
      .object({
        sourceUri: z.string(),
        output: z.string(),
        lufsTarget: z.number().default(-14),
      })
      .parse(input);
    await loudnorm(sourceUri, output, lufsTarget);
    return { output };
  },
  duck_music_under_voice: async (_ctx, input) => {
    const { composition, musicClipId, voiceClipId, amountDb } = z
      .object({
        composition: CompositionSchema,
        musicClipId: z.string(),
        voiceClipId: z.string(),
        amountDb: z.number().min(1).max(30).default(10),
      })
      .parse(input);
    const next = structuredClone(composition);
    const music = next.clips.find((c) => c.id === musicClipId);
    if (!music) throw new Error(`unknown clip: ${musicClipId}`);
    music.props = { ...music.props, duckUnder: voiceClipId, duckAmountDb: amountDb };
    return { composition: CompositionSchema.parse(next) };
  },
  ken_burns: async (_ctx, input) => {
    const args = blockClipInput("KenBurnsImage").parse(input);
    return { composition: addClip(args.composition, args) };
  },
  reframe_to_aspect: async (_ctx, input) => {
    const { composition, aspect } = z
      .object({
        composition: CompositionSchema,
        aspect: z.enum(["9:16", "16:9", "1:1"]),
      })
      .parse(input);
    const canvas =
      aspect === "9:16"
        ? { width: 1080, height: 1920, fps: composition.canvas.fps }
        : aspect === "16:9"
          ? { width: 1920, height: 1080, fps: composition.canvas.fps }
          : { width: 1080, height: 1080, fps: composition.canvas.fps };
    return { composition: setCompositionMeta(composition, canvas) };
  },
  lint_composition: async (_ctx, input) => {
    const { composition, presetId } = z
      .object({
        composition: CompositionSchema,
        presetId: z.string().default("youtube-essay"),
      })
      .parse(input);
    return dryRender(composition, getPreset(presetId));
  },
  dry_render: async (_ctx, input) => {
    const { composition, presetId } = z
      .object({
        composition: CompositionSchema,
        presetId: z.string().default("youtube-essay"),
      })
      .parse(input);
    return dryRender(composition, getPreset(presetId));
  },
  cost_estimate: async (_ctx, input) => {
    const composition = parseComposition(input);
    return { entries: [priceRender(composition.duration)] };
  },
  render: async (ctx, input) => {
    const { composition, presetId } = z
      .object({
        composition: CompositionSchema,
        presetId: z.string().default("youtube-essay"),
      })
      .parse(input);
    const result = await runRender({
      projectId: ctx.projectId,
      composition,
      preset: getPreset(presetId),
      workDir: ctx.workDir,
    });
    return {
      mp4Path: result.mp4Path,
      htmlPath: result.htmlPath,
      publicUrl: result.publicUrl,
      totalFrames: result.totalFrames,
      elapsedMs: result.elapsedMs,
    };
  },
  cancel_render: async () => ({
    cancelled: false,
    reason: "no active render handle for this dispatcher call",
  }),
};

export type ToolName = keyof typeof TOOL_IMPLS;

export function listTools(): ToolName[] {
  return Object.keys(TOOL_IMPLS) as ToolName[];
}

/** Re-export the manifest type so apps/worker doesn't double-import. */
export type ToolManifest = typeof TOOL_MANIFEST;
