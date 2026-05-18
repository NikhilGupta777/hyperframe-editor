/**
 * composeHtml — Generates a full HyperFrames-valid HTML composition using Gemini.
 *
 * Instead of the limited block-based builder, this agent asks Gemini to write
 * a complete HTML composition with:
 *   - Proper <video>, <img>, <audio> clips with data-start/data-duration/data-track-index
 *   - Rich GSAP animations (scale, rotation, opacity, x/y, color transitions)
 *   - Transitions between scenes (crossfades, wipes, zooms)
 *   - Multi-track layering (backgrounds, content, overlays, captions)
 *   - Cinematic motion (Ken Burns, parallax, kinetic typography)
 *
 * The composition follows HyperFrames HTML schema:
 *   - Root div with data-composition-id, data-width, data-height, data-start
 *   - Timed elements have class="clip", data-start, data-duration, data-track-index
 *   - GSAP timeline registered as window.__timelines["main"], paused
 *   - No Math.random, no Date.now, no setTimeout, no infinite loops
 *   - Video elements are muted (audio goes in separate <audio> elements)
 */
import { vertex } from "@hyperframe-editor/providers";
import type { Preset, Beat, AssetRef } from "@hyperframe-editor/core";

export interface ComposeHtmlRequest {
  projectId: string;
  brief: { title: string; summary: string; mandates: string[] };
  beats: Beat[];
  assets: Array<{ beatId: string; slot: string; asset: AssetRef }>;
  preset: Preset;
}

export interface ComposeHtmlResult {
  html: string;
  tokensIn: number;
  tokensOut: number;
}

const SYSTEM_PROMPT = `You are an expert HyperFrames video composition author. You write complete, production-ready HTML compositions that render to stunning videos.

## HyperFrames HTML Schema Rules (MUST follow):
1. Root element: <div class="composition" data-composition-id="main" data-width="WIDTH" data-height="HEIGHT" data-start="0" data-duration="TOTAL_DURATION">
2. Every visible timed element MUST have: class="clip", data-start="SECONDS", data-duration="SECONDS", data-track-index="N"
3. Video elements: <video class="clip" muted playsinline preload="auto" data-start="S" data-duration="S" data-track-index="N" src="PATH"></video>
4. Image elements: <img class="clip" data-start="S" data-duration="S" data-track-index="N" src="PATH" alt="">
5. GSAP timeline: const tl = gsap.timeline({ paused: true }); ... window.__timelines["main"] = tl;
6. Use tl.fromTo() for all animations (never tl.from — it breaks seeking)
7. Position parameter (3rd arg) for absolute timing: tl.fromTo(el, {from}, {to}, startTime)
8. NO Math.random, NO Date.now, NO setTimeout, NO setInterval, NO repeat:-1
9. All video elements MUST be muted
10. Timeline duration must match composition duration (use tl.set({}, {}, totalDuration) at end)

## Animation Best Practices:
- Every scene entrance needs animation (fade, scale, slide — never just "appear")
- Add transitions between scenes (crossfade overlaps of 0.3-0.5s)
- Use Ken Burns (slow scale 1.0→1.08 or 1.08→1.0) on all background images
- Kinetic typography: stagger word reveals, use scale/rotation for emphasis
- Lower thirds: slide in from left, hold, slide out
- Use easing: "power2.out" for entrances, "power2.inOut" for exits, "back.out(1.4)" for bouncy

## Visual Design:
- Layer content: track 0 = backgrounds, track 1 = main content, track 2 = overlays, track 3 = text/captions
- Use CSS backdrop-filter for glass effects
- Add subtle text-shadow for readability over images/video
- Use the preset's color palette and font pair consistently

## Output Format:
Return ONLY the complete HTML document (<!DOCTYPE html> to </html>). No markdown fences, no commentary.`;

export async function composeHtml(req: ComposeHtmlRequest): Promise<ComposeHtmlResult> {
  const assetMap = req.assets.map((a) => ({
    beatId: a.beatId,
    slot: a.slot,
    kind: a.asset.kind,
    src: a.asset.src,
    width: a.asset.width,
    height: a.asset.height,
  }));

  const userMsg = JSON.stringify({
    projectId: req.projectId,
    canvas: req.preset.canvas,
    palette: req.preset.palette,
    fontPair: req.preset.fontPair,
    brief: req.brief,
    beats: req.beats.map((b) => ({
      id: b.id,
      narration: b.narration,
      duration: b.duration,
      blocks: b.blocks,
    })),
    assets: assetMap,
    totalDuration: req.beats.reduce((sum, b) => sum + b.duration, 0),
    instructions: [
      "Create a visually stunning, cinematic composition",
      "Use ALL provided assets — place videos and images as full-bleed backgrounds with Ken Burns",
      "Add kinetic typography for narration text with staggered word reveals",
      "Include smooth transitions between beats (crossfade, scale, or slide)",
      "Layer: backgrounds (track 0) → content (track 1) → overlays (track 2) → text (track 3)",
      "Every element must animate in AND out — no static appearances",
      "Use the font pair: display font for headlines, body font for subtitles",
      "Match the color palette for all text and accent elements",
      "Add a cinematic vignette overlay on the top track",
      "Include GSAP CDN and HyperFrames runtime CDN script tags",
    ],
  });

  const r = await vertex.generateText({
    model: "reasoning",
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userMsg }],
    temperature: 0.7,
    maxOutputTokens: 32000,
  });

  // Extract HTML from the response — strip markdown fences if present
  let html = r.text;
  if (html.startsWith("```html")) {
    html = html.slice(7);
  } else if (html.startsWith("```")) {
    html = html.slice(3);
  }
  if (html.endsWith("```")) {
    html = html.slice(0, -3);
  }
  html = html.trim();

  // Ensure it starts with DOCTYPE
  if (!html.startsWith("<!DOCTYPE")) {
    const idx = html.indexOf("<!DOCTYPE");
    if (idx > 0) html = html.slice(idx);
  }

  return {
    html,
    tokensIn: r.tokensIn,
    tokensOut: r.tokensOut,
  };
}
