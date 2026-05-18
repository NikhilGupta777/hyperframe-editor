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

// ---------------------------------------------------------------------------
// Additional palettes + font pairs for the wider preset library
// ---------------------------------------------------------------------------

const STUDIO_DARK: Palette = {
  name: "studioDark",
  bg: "#0e1116",
  fg: "#f3f5f9",
  accent: "#3ddcff",
  muted: "#7f8a9b",
};

const TEMPLE_GOLD: Palette = {
  name: "templeGold",
  bg: "#1b0f06",
  fg: "#fff5dd",
  accent: "#f7c34a",
  muted: "#9c7a45",
};

const PRODUCT_LIGHT: Palette = {
  name: "productLight",
  bg: "#fafafa",
  fg: "#0c0d10",
  accent: "#1452ff",
  muted: "#9ba1ad",
};

const ESSAY_PAPER: Palette = {
  name: "essayPaper",
  bg: "#f4eee2",
  fg: "#1a1814",
  accent: "#a83a2c",
  muted: "#7a6a5a",
};

const POPPINS_INTER: FontPair = { display: "Poppins", body: "Inter" };
const PLAYFAIR_INTER: FontPair = { display: "Playfair Display", body: "Inter" };
const NOTO_DEVANAGARI: FontPair = { display: "Noto Sans Devanagari", body: "Inter" };
const OSWALD_INTER: FontPair = { display: "Oswald", body: "Inter" };

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

export const YOUTUBE_SHORT: Preset = {
  id: "youtube-short",
  label: "YouTube Short (9:16, up to 60s)",
  canvas: { width: 1080, height: 1920, fps: 30 },
  palette: STUDIO_DARK,
  fontPair: POPPINS_INTER,
  skeleton: [
    { id: "hook", durRange: [2, 4], blocks: ["HookTitle", "KineticHeadline"] },
    { id: "body", durRange: [20, 50], blocks: ["CaptionBlock", "KenBurnsImage", "BRollWindow"] },
    { id: "cta", durRange: [3, 6], blocks: ["EndCard", "LogoBug"] },
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

export const YOUTUBE_ESSAY: Preset = {
  id: "youtube-essay",
  label: "YouTube essay (16:9, 3–10 min)",
  canvas: { width: 1920, height: 1080, fps: 30 },
  palette: ESSAY_PAPER,
  fontPair: PLAYFAIR_INTER,
  skeleton: [
    { id: "hook", durRange: [3, 6], blocks: ["HookTitle", "KineticHeadline"] },
    { id: "intro", durRange: [8, 20], blocks: ["KenBurnsImage", "LowerThird", "QuoteCard"] },
    { id: "point-1", durRange: [15, 60], blocks: ["KenBurnsImage", "BRollWindow", "LowerThird", "CaptionBlock"] },
    { id: "point-2", durRange: [15, 60], blocks: ["BRollWindow", "KenBurnsImage", "KineticHeadline", "CaptionBlock"] },
    { id: "point-3", durRange: [15, 60], blocks: ["KenBurnsImage", "BRollWindow", "QuoteCard", "LowerThird"] },
    { id: "climax", durRange: [10, 40], blocks: ["KineticHeadline", "BRollWindow", "KenBurnsImage"] },
    { id: "outro", durRange: [5, 12], blocks: ["EndCard", "QuoteCard", "LogoBug"] },
  ],
  guardrails: {
    maxDuration: 720,
    minDuration: 60,
    requireCaptions: false,
    requireCta: true,
    lufsTarget: -16,
    titleSafe: [0.05, 0.95],
  },
};

export const DEVOTIONAL_REEL: Preset = {
  id: "devotional-reel",
  label: "Devotional reel (9:16, scripture + ambient)",
  canvas: { width: 1080, height: 1920, fps: 30 },
  palette: TEMPLE_GOLD,
  fontPair: NOTO_DEVANAGARI,
  skeleton: [
    { id: "open", durRange: [2, 4], blocks: ["HookTitle"] },
    { id: "verse", durRange: [10, 30], blocks: ["QuoteCard", "KenBurnsImage"] },
    { id: "cta", durRange: [3, 6], blocks: ["EndCard", "LogoBug"] },
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

export const PRODUCT_PROMO: Preset = {
  id: "product-promo",
  label: "Product promo (16:9, 20–45s)",
  canvas: { width: 1920, height: 1080, fps: 30 },
  palette: PRODUCT_LIGHT,
  fontPair: POPPINS_INTER,
  skeleton: [
    { id: "hook", durRange: [2, 4], blocks: ["HookTitle"] },
    { id: "feature", durRange: [10, 26], blocks: ["KenBurnsImage", "BRollWindow", "CaptionBlock"] },
    { id: "cta", durRange: [3, 6], blocks: ["EndCard", "LogoBug"] },
  ],
  guardrails: {
    maxDuration: 45,
    minDuration: 15,
    requireCaptions: true,
    requireCta: true,
    lufsTarget: -14,
    titleSafe: [0.06, 0.94],
  },
};

export const PODCAST_CLIP: Preset = {
  id: "podcast-clip",
  label: "Podcast clip (9:16, 30–90s, captions over speaker)",
  canvas: { width: 1080, height: 1920, fps: 30 },
  palette: STUDIO_DARK,
  fontPair: OSWALD_INTER,
  skeleton: [
    { id: "open", durRange: [2, 4], blocks: ["HookTitle", "LowerThird"] },
    { id: "body", durRange: [20, 80], blocks: ["BRollWindow", "CaptionBlock", "LowerThird"] },
    { id: "cta", durRange: [3, 6], blocks: ["EndCard", "LogoBug"] },
  ],
  guardrails: {
    maxDuration: 90,
    minDuration: 30,
    requireCaptions: true,
    requireCta: true,
    lufsTarget: -14,
    titleSafe: [0.08, 0.92],
  },
};

export const EDUCATIONAL_EXPLAINER: Preset = {
  id: "educational-explainer",
  label: "Educational explainer (16:9, 60–180s)",
  canvas: { width: 1920, height: 1080, fps: 30 },
  palette: ESSAY_PAPER,
  fontPair: POPPINS_INTER,
  skeleton: [
    { id: "intro", durRange: [3, 8], blocks: ["HookTitle"] },
    { id: "body", durRange: [50, 160], blocks: ["KenBurnsImage", "QuoteCard", "CaptionBlock", "LowerThird"] },
    { id: "summary", durRange: [4, 12], blocks: ["EndCard"] },
  ],
  guardrails: {
    maxDuration: 180,
    minDuration: 60,
    requireCaptions: true,
    requireCta: true,
    lufsTarget: -16,
    titleSafe: [0.06, 0.94],
  },
};

export const BLANK_VERTICAL: Preset = {
  id: "blank-vertical",
  label: "Blank (9:16)",
  canvas: { width: 1080, height: 1920, fps: 30 },
  palette: NEON_NIGHT,
  fontPair: ARCHIVO_INTER,
  skeleton: [{ id: "main", durRange: [1, 600], blocks: ["HookTitle"] }],
  guardrails: {
    maxDuration: 600,
    minDuration: 1,
    requireCaptions: false,
    requireCta: false,
    lufsTarget: -14,
    titleSafe: [0.05, 0.95],
  },
};

export const BLANK_HORIZONTAL: Preset = {
  id: "blank-horizontal",
  label: "Blank (16:9)",
  canvas: { width: 1920, height: 1080, fps: 30 },
  palette: STUDIO_DARK,
  fontPair: ARCHIVO_INTER,
  skeleton: [{ id: "main", durRange: [1, 600], blocks: ["HookTitle"] }],
  guardrails: {
    maxDuration: 600,
    minDuration: 1,
    requireCaptions: false,
    requireCta: false,
    lufsTarget: -16,
    titleSafe: [0.05, 0.95],
  },
};

/** Full preset registry. */
export const PRESETS: Record<string, Preset> = {
  [TIKTOK_HOOK.id]: TIKTOK_HOOK,
  [YOUTUBE_SHORT.id]: YOUTUBE_SHORT,
  [YOUTUBE_ESSAY.id]: YOUTUBE_ESSAY,
  [DEVOTIONAL_REEL.id]: DEVOTIONAL_REEL,
  [PRODUCT_PROMO.id]: PRODUCT_PROMO,
  [PODCAST_CLIP.id]: PODCAST_CLIP,
  [EDUCATIONAL_EXPLAINER.id]: EDUCATIONAL_EXPLAINER,
  [BLANK_VERTICAL.id]: BLANK_VERTICAL,
  [BLANK_HORIZONTAL.id]: BLANK_HORIZONTAL,
};

export function getPreset(id: string): Preset {
  const p = PRESETS[id];
  if (!p) throw new Error(`Unknown preset: ${id}`);
  return p;
}
