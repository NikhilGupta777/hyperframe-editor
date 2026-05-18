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
import { HYPERFRAMES_KNOWLEDGE } from "./hyperframes-knowledge.js";

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

const SYSTEM_PROMPT = `You are an expert HyperFrames video composition author. You write complete, production-ready HTML compositions that render to stunning, cinematic videos.

${HYPERFRAMES_KNOWLEDGE}

## YOUR TASK:
Given a creative brief, beat plan, and acquired assets, generate a COMPLETE HyperFrames HTML composition.
The output must be a valid HTML document from <!DOCTYPE html> to </html>.
Use ALL provided assets. Create rich, cinematic animations with smooth transitions between every scene.
Every element must animate in AND out. No static appearances. No jump cuts.
Output ONLY the HTML — no markdown fences, no commentary, no explanation.`;

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
