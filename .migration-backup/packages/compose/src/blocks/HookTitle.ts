import type { Palette, FontPair } from "@hyperframe-editor/core";
import type { BlockFragment } from "./index.js";
import { escapeHtml, escapeCss } from "../util/escape.js";

export interface HookTitleProps {
  /** Stable id, used to scope CSS and to register this block's GSAP target. */
  id: string;
  start: number;
  duration: number;
  trackIndex: number;
  text: string;
  subtext?: string;
  palette: Palette;
  fontPair: FontPair;
}

/**
 * HookTitle — a 2-4s opener with a kinetic display headline.
 *
 * Determinism rules followed:
 *  - the GSAP tween is added to `tl` (not the bare gsap timeline),
 *  - we use `fromTo` with explicit start/end values (never `from`),
 *  - no `Math.random`, no time-based math.
 */
export function hookTitle(p: HookTitleProps): BlockFragment {
  const cls = `hook-${p.id}`;
  const html = `
<div class="clip ${cls}"
     data-clip-id="${p.id}"
     data-start="${p.start.toFixed(3)}"
     data-duration="${p.duration.toFixed(3)}"
     data-track-index="${p.trackIndex}">
  <h1 class="${cls}__title">${escapeHtml(p.text)}</h1>
  ${p.subtext ? `<p class="${cls}__sub">${escapeHtml(p.subtext)}</p>` : ""}
</div>`.trim();

  const css = `
.${cls} {
  position: absolute; inset: 0;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  background: ${escapeCss(p.palette.bg)};
  color: ${escapeCss(p.palette.fg)};
  padding: 6%;
}
.${cls}__title {
  font-family: "${escapeCss(p.fontPair.display)}", system-ui, sans-serif;
  font-size: clamp(72px, 13vw, 220px);
  line-height: 0.95;
  text-align: center;
  letter-spacing: -0.02em;
  text-shadow: 0 4px 24px rgba(0,0,0,0.45);
}
.${cls}__sub {
  font-family: "${escapeCss(p.fontPair.body)}", system-ui, sans-serif;
  font-size: clamp(28px, 3vw, 56px);
  margin-top: 1em;
  opacity: 0.85;
}
`.trim();

  // Animate from offscreen-up to centre over the first 0.6s; hold; fade out at end.
  const enter = Math.min(0.6, p.duration * 0.25);
  const exit = Math.min(0.4, p.duration * 0.2);
  const holdEnd = Math.max(p.duration - exit, enter);
  const js = `
{
  const root = document.querySelector(".${cls}");
  const title = document.querySelector(".${cls}__title");
  if (root && title) {
    tl.fromTo(title, { y: -120, opacity: 0 }, { y: 0, opacity: 1, duration: ${enter.toFixed(3)}, ease: "power3.out" }, ${p.start.toFixed(3)});
    tl.to(title, { opacity: 0, duration: ${exit.toFixed(3)}, ease: "power2.inOut" }, ${(p.start + holdEnd).toFixed(3)});
  }
}
`.trim();

  return { html, css, js };
}
