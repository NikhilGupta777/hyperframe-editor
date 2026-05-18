export interface Preset {
  id: string;
  label: string;
  canvas: { width: number; height: number; fps: number };
}

export const PRESETS: Record<string, Preset> = {
  "youtube-essay": { id: "youtube-essay", label: "YouTube Essay", canvas: { width: 1920, height: 1080, fps: 30 } },
  "tiktok-hook": { id: "tiktok-hook", label: "TikTok Hook", canvas: { width: 1080, height: 1920, fps: 30 } },
  "product-promo": { id: "product-promo", label: "Product Promo", canvas: { width: 1080, height: 1080, fps: 30 } },
  "podcast-clip": { id: "podcast-clip", label: "Podcast Clip", canvas: { width: 1080, height: 1920, fps: 30 } },
  "educational-explainer": { id: "educational-explainer", label: "Educational Explainer", canvas: { width: 1920, height: 1080, fps: 30 } },
  "devotional-reel": { id: "devotional-reel", label: "Devotional Reel", canvas: { width: 1080, height: 1920, fps: 30 } },
};

export const GATE_CATALOG: Record<string, { name: string }> = {
  G1: { name: "Timeline non-empty" },
  G2: { name: "No orphan assets" },
  G3: { name: "Duration in range" },
  G4: { name: "Audio present" },
  G5: { name: "Caption track" },
  G6: { name: "Aspect ratio" },
  G7: { name: "No off-origin fetch" },
  G8: { name: "Cost within budget" },
};
