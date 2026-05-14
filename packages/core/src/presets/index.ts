import { z } from "zod";
import { CanvasSchema } from "../composition.js";

export const PaletteSchema = z.object({
  name: z.string(),
  bg: z.string(),
  fg: z.string(),
  accent: z.string(),
  muted: z.string(),
});
export type Palette = z.infer<typeof PaletteSchema>;

export const FontPairSchema = z.object({
  display: z.string(),
  body: z.string(),
});
export type FontPair = z.infer<typeof FontPairSchema>;

export const BeatSlotSchema = z.object({
  id: z.string(),
  /** Allowed range of seconds for this beat. */
  durRange: z.tuple([z.number().positive(), z.number().positive()]),
  /** Block names from packages/compose/blocks the planner may pick from. */
  blocks: z.array(z.string()).min(1),
});
export type BeatSlot = z.infer<typeof BeatSlotSchema>;

export const PresetSchema = z.object({
  id: z.string(),
  label: z.string(),
  canvas: CanvasSchema,
  palette: PaletteSchema,
  fontPair: FontPairSchema,
  /** Ordered beat skeleton. The planner picks beats[i].duration in durRange. */
  skeleton: z.array(BeatSlotSchema).min(1),
  guardrails: z.object({
    maxDuration: z.number().positive(),
    minDuration: z.number().positive(),
    requireCaptions: z.boolean().default(false),
    requireCta: z.boolean().default(false),
    /** LUFS target for gate G5. */
    lufsTarget: z.number().default(-14),
    /** Title-safe inset (fraction of canvas) for gate G4. */
    titleSafe: z.tuple([z.number(), z.number()]).default([0.05, 0.95]),
  }),
});
export type Preset = z.infer<typeof PresetSchema>;

const NEON_NIGHT: Palette = {
  name: "neonNight",
  bg: "#0b0f17",
  fg: "#f5f7fb",
  accent: "#ff3df8",
  muted: "#7c8aa6",
};

const ARCHIVO_INTER: FontPair = {
  display: "Archivo Black",
  body: "Inter",
};

export const TIKTOK_HOOK: Preset = {
  id: "tiktok-hook",
  label: "TikTok-style hook reel (9:16, 30s)",
  canvas: { width: 1080, height: 1920, fps: 30 },
  palette: NEON_NIGHT,
  fontPair: ARCHIVO_INTER,
  skeleton: [
    { id: "hook", durRange: [2, 4], blocks: ["HookTitle"] },
    { id: "promise", durRange: [3, 5], blocks: ["KineticHeadline", "BRollWindow"] },
    { id: "body", durRange: [15, 22], blocks: ["CaptionBlock", "KenBurnsImage", "SplitScreen"] },
    { id: "cta", durRange: [3, 5], blocks: ["EndCard"] },
  ],
  guardrails: {
    maxDuration: 60,
    minDuration: 15,
    requireCaptions: true,
    requireCta: true,
    lufsTarget: -14,
    titleSafe: [0.08, 0.92],
  },
};

/** Preset registry. Phase 2 fills in the remaining 9 from PLAN §5.2. */
export const PRESETS: Record<string, Preset> = {
  [TIKTOK_HOOK.id]: TIKTOK_HOOK,
};

export function getPreset(id: string): Preset {
  const p = PRESETS[id];
  if (!p) throw new Error(`Unknown preset: ${id}`);
  return p;
}
