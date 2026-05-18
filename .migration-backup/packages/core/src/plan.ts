import { z } from "zod";

/**
 * A Beat is one narrative unit. The planner emits a sequence of beats; the builder
 * turns each beat into one or more clips by picking blocks from the registry.
 */
export const BeatSchema = z.object({
  id: z.string(),
  /** What the viewer sees / hears in this beat, in plain language. */
  narration: z.string().optional(),
  /** Timing. The planner can leave start undefined and the builder lays them in sequence. */
  start: z.number().nonnegative().optional(),
  duration: z.number().positive(),
  /** Block names from packages/compose/blocks the planner suggests for this beat. */
  blocks: z.array(z.string()).default([]),
  /** Asset cues the planner asks for; the orchestrator resolves these to AssetRefs. */
  assetCues: z
    .array(
      z.object({
        slot: z.string(),
        /** Free-text query for stock or AI gen. */
        query: z.string(),
        kind: z.enum(["image", "video", "audio"]),
      }),
    )
    .default([]),
});
export type Beat = z.infer<typeof BeatSchema>;

export const StoryboardSchema = z.object({
  title: z.string(),
  preset: z.string(),
  beats: z.array(BeatSchema).min(1),
});
export type Storyboard = z.infer<typeof StoryboardSchema>;

export const DesignSchema = z.object({
  palette: z.array(z.string()).min(2),
  fontPair: z.object({
    display: z.string(),
    body: z.string(),
  }),
  motion: z.enum(["calm", "energetic", "cinematic", "kinetic"]).default("calm"),
  transitions: z.array(z.string()).default([]),
});
export type Design = z.infer<typeof DesignSchema>;

/**
 * Edit Decision List — used by the EDIT-SOURCE loop to describe how source video(s)
 * are cut and overlaid before being wrapped in a HyperFrames composition.
 */
export const EDLEntrySchema = z.object({
  sourceId: z.string(),
  in: z.number().nonnegative(),
  out: z.number().nonnegative(),
  layer: z.number().int().min(0).default(0),
  /** Optional reframe / crop / speed expressed deterministically. */
  crop: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional(),
  speed: z.number().positive().default(1),
});
export type EDLEntry = z.infer<typeof EDLEntrySchema>;

export const EDLSchema = z.object({
  entries: z.array(EDLEntrySchema),
});
export type EDL = z.infer<typeof EDLSchema>;
