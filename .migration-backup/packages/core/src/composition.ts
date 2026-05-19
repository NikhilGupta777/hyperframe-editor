import { z } from "zod";

/**
 * Canvas is the immutable identity of a HyperFrames composition: dimensions and frame rate.
 * The renderer needs all three to seek deterministically.
 */
export const CanvasSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  fps: z.number().int().positive().default(30),
});
export type Canvas = z.infer<typeof CanvasSchema>;

/**
 * AssetRef is a logical pointer to a media file. It can be:
 *  - a local relative path inside the composition's project dir ("assets/foo.mp4")
 *  - an oci:// URI which the renderer resolves to a presigned URL at render time
 *  - an https:// URL which we vendor into assets/ during the build phase (no network at render)
 */
export const AssetRefSchema = z.object({
  id: z.string(),
  kind: z.enum(["video", "image", "audio"]),
  src: z.string(),
  /** Original duration of the underlying media; used by gates and the planner. */
  durationSec: z.number().nonnegative().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  /** sha256 of the source bytes. Used as cache key + integrity check. */
  hash: z.string().optional(),
  /** License + attribution we must surface to the user. */
  attribution: z
    .object({
      provider: z.string(),
      author: z.string().optional(),
      authorUrl: z.string().url().optional(),
      sourceUrl: z.string().url().optional(),
      license: z.string(),
    })
    .optional(),
});
export type AssetRef = z.infer<typeof AssetRefSchema>;

/**
 * A Composition is the AST our editor mutates. We serialise to HyperFrames HTML on every commit.
 * The HTML on disk is the source of truth, but the AST is the only thing the agent's tools touch.
 */
export const ClipKindSchema = z.enum(["video", "image", "audio", "text", "block"]);

export const ClipSchema = z.object({
  id: z.string(),
  kind: ClipKindSchema,
  trackIndex: z.number().int().min(0),
  start: z.number().nonnegative(),
  duration: z.number().positive(),
  /** When kind=video|audio, the offset into the source media to start playback from. */
  playbackOffset: z.number().nonnegative().default(0),
  assetId: z.string().optional(),
  /** When kind=text or kind=block, an arbitrary props bag the block renderer consumes. */
  props: z.record(z.unknown()).default({}),
  /** When kind=block, the registered block name (e.g. "HookTitle", "LowerThird"). */
  block: z.string().optional(),
});
export type Clip = z.infer<typeof ClipSchema>;

export const CompositionSchema = z.object({
  id: z.string(),
  canvas: CanvasSchema,
  /** Total duration. Must equal max(clip.start + clip.duration). Enforced by gate G3. */
  duration: z.number().positive(),
  assets: z.array(AssetRefSchema).default([]),
  clips: z.array(ClipSchema).default([]),
  /** Variables passed to blocks at render time. Maps to `<root data-vars>` in HyperFrames. */
  variables: z.record(z.unknown()).default({}),
});
export type Composition = z.infer<typeof CompositionSchema>;

/** Compute the implied total duration from clips. */
export function computeDuration(c: Composition): number {
  if (c.clips.length === 0) return 0;
  let max = 0;
  for (const clip of c.clips) {
    const end = clip.start + clip.duration;
    if (end > max) max = end;
  }
  return Number(max.toFixed(6));
}
