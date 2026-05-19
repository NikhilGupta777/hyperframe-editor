export interface Preset {
  id: string;
  label: string;
  canvas: { width: number; height: number; fps: number };
}

export const PRESETS: Record<string, Preset> = {
  "youtube-essay":         { id: "youtube-essay",         label: "YouTube Essay",         canvas: { width: 1920, height: 1080, fps: 30 } },
  "tiktok-hook":           { id: "tiktok-hook",           label: "TikTok Hook",           canvas: { width: 1080, height: 1920, fps: 30 } },
  "product-promo":         { id: "product-promo",         label: "Product Promo",         canvas: { width: 1080, height: 1080, fps: 30 } },
  "podcast-clip":          { id: "podcast-clip",          label: "Podcast Clip",          canvas: { width: 1080, height: 1920, fps: 30 } },
  "educational-explainer": { id: "educational-explainer", label: "Educational Explainer", canvas: { width: 1920, height: 1080, fps: 30 } },
  "devotional-reel":       { id: "devotional-reel",       label: "Devotional Reel",       canvas: { width: 1080, height: 1920, fps: 30 } },
};

/**
 * Quality gates — aligned with the HyperFrames "Rule of Three":
 * https://hyperframes.heygen.com | github.com/heygen-com/hyperframes
 *
 * Rule 1: Root element needs data-composition-id, data-width, data-height
 * Rule 2: Root element needs data-start and data-duration
 * Rule 3: Clips need class="clip", data-start, data-duration, data-track-index
 * Rule 4: GSAP timelines must be paused:true, registered on window.__timelines
 */
export const GATE_CATALOG: Record<string, { name: string; rule: string }> = {
  G1: { name: "Root attrs",     rule: "Rule 1 — Root div has data-composition-id, data-width, data-height" },
  G2: { name: "Root timing",    rule: "Rule 2 — Root div has data-start and data-duration" },
  G3: { name: "Clip attrs",     rule: "Rule 3 — All .clip elements have data-start, data-duration, data-track-index" },
  G4: { name: "GSAP paused",    rule: "Rule 3 — Timelines are paused:true, registered on window.__timelines" },
  G5: { name: "No wall-clock",  rule: "No setTimeout / setInterval / rAF (breaks deterministic seeking)" },
  G6: { name: "Canvas size",    rule: "data-width × data-height match a valid HyperFrames preset" },
  G7: { name: "Audio",          rule: "Composition has audio (background music or narration)" },
  G8: { name: "Safe media",     rule: "No off-origin image/video URLs that break headless render" },
};
