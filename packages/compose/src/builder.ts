import type { Composition, Preset } from "@hyperframe-editor/core";
import { computeDuration } from "@hyperframe-editor/core";
import { BLOCKS, type BlockName, type BlockFragment } from "./blocks/index.js";

const GSAP_CDN = "https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js";
const HF_RUNTIME_CDN = "https://cdn.jsdelivr.net/npm/@hyperframes/core/dist/hyperframe.runtime.iife.js";

/**
 * Render a Composition AST as a complete HyperFrames-valid HTML document.
 *
 * Determinism contract (enforced by gates G2, G7):
 *   - root has data-composition-id, data-width, data-height, data-start, data-duration
 *   - GSAP timeline lives on window.__timelines["main"], paused
 *   - inline scripts have no Math.random, no Date.now, no setTimeout/setInterval, no repeat:-1
 *   - all clip elements have class="clip", data-start, data-duration, data-track-index
 *   - gsap and the HF runtime are the only off-origin scripts (G7 allows these two CDNs)
 *
 * Idempotent: same input → byte-identical output (modulo locale-independent number formatting).
 */
export interface BuildOptions {
  preset: Preset;
  composition: Composition;
  /**
   * If true, omit the GSAP/runtime CDN <script> tags. Used by tests; the renderer
   * needs them present.
   */
  bare?: boolean;
}

export function buildCompositionHtml({ preset, composition, bare }: BuildOptions): string {
  const fragments: BlockFragment[] = [];

  for (const clip of composition.clips) {
    if (clip.kind !== "block") continue;
    const blockName = clip.block as BlockName | undefined;
    if (!blockName || !(blockName in BLOCKS)) {
      throw new Error(`Unknown block: ${String(blockName)} (clip ${clip.id})`);
    }
    const renderer = BLOCKS[blockName];
    fragments.push(
      renderer({
        id: clip.id,
        start: clip.start,
        duration: clip.duration,
        trackIndex: clip.trackIndex,
        palette: preset.palette,
        fontPair: preset.fontPair,
        ...clip.props,
      } as never),
    );
  }

  const totalDuration = composition.duration || computeDuration(composition);

  const html = fragments.map((f) => f.html).join("\n");
  const css = fragments.map((f) => f.css).join("\n\n");
  const js = fragments.map((f) => f.js).join("\n\n");

  const fontFamilies = encodeURIComponent(
    [preset.fontPair.display, preset.fontPair.body]
      .map((f) => `family=${f.replace(/ /g, "+")}:wght@400;700`)
      .join("&"),
  );

  const gsapTag = bare ? "" : `<script src="${GSAP_CDN}"></script>`;
  const runtimeTag = bare ? "" : `<script src="${HF_RUNTIME_CDN}"></script>`;

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=${composition.canvas.width}, height=${composition.canvas.height}">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?${fontFamilies}&display=block" rel="stylesheet">
<style>
*, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
html, body { width: ${composition.canvas.width}px; height: ${composition.canvas.height}px; overflow: hidden; background: ${preset.palette.bg}; color: ${preset.palette.fg}; }
.composition { position: relative; width: 100%; height: 100%; overflow: hidden; }
.clip { position: absolute; inset: 0; }
${css}
</style>
</head>
<body>
<div class="composition"
     data-composition-id="main"
     data-width="${composition.canvas.width}"
     data-height="${composition.canvas.height}"
     data-fps="${composition.canvas.fps}"
     data-start="0"
     data-duration="${totalDuration.toFixed(3)}">
${html}
</div>
${gsapTag}
${runtimeTag}
<script>
window.__timelines = window.__timelines || {};
const tl = gsap.timeline({ paused: true });
${js}
// Ensure the timeline duration covers the full composition for accurate seeking.
tl.set({}, {}, ${totalDuration.toFixed(3)});
window.__timelines["main"] = tl;
</script>
</body>
</html>`;
}
