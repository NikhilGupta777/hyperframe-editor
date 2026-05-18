import type { Palette, FontPair } from "@hyperframe-editor/core";
import type { BlockFragment } from "./index.js";
import { escapeHtml, escapeCss } from "../util/escape.js";

export interface LowerThirdProps {
  id: string;
  start: number;
  duration: number;
  trackIndex: number;
  name: string;
  role?: string;
  /** Position from the bottom edge (fraction). Default 0.12. */
  bottomFraction?: number;
  palette: Palette;
  fontPair: FontPair;
}

export function lowerThird(p: LowerThirdProps): BlockFragment {
  const cls = `lt-${p.id}`;
  const html = `
<div class="clip ${cls}"
     data-clip-id="${p.id}"
     data-start="${p.start.toFixed(3)}"
     data-duration="${p.duration.toFixed(3)}"
     data-track-index="${p.trackIndex}">
  <div class="${cls}__bar">
    <div class="${cls}__name">${escapeHtml(p.name)}</div>
    ${p.role ? `<div class="${cls}__role">${escapeHtml(p.role)}</div>` : ""}
  </div>
</div>`.trim();

  const bottomPct = ((p.bottomFraction ?? 0.12) * 100).toFixed(1);
  const css = `
.${cls} { position: absolute; inset: 0; pointer-events: none; }
.${cls}__bar {
  position: absolute; left: 6%; bottom: ${bottomPct}%;
  background: linear-gradient(135deg, ${escapeCss(p.palette.bg)}cc, ${escapeCss(p.palette.bg)}88);
  color: ${escapeCss(p.palette.fg)};
  border-left: 6px solid ${escapeCss(p.palette.accent)};
  padding: 0.7em 1.2em;
  border-radius: 4px;
  backdrop-filter: blur(6px);
}
.${cls}__name {
  font-family: "${escapeCss(p.fontPair.display)}", sans-serif;
  font-size: clamp(28px, 3.4vw, 60px);
  letter-spacing: -0.01em;
}
.${cls}__role {
  font-family: "${escapeCss(p.fontPair.body)}", sans-serif;
  font-size: clamp(18px, 1.8vw, 32px);
  opacity: 0.85;
  margin-top: 0.2em;
}
`.trim();

  const enter = Math.min(0.4, p.duration * 0.2);
  const exit = Math.min(0.3, p.duration * 0.18);
  const exitAt = p.start + p.duration - exit;

  const js = `
tl.fromTo(".${cls}__bar", { x: -180, opacity: 0 }, { x: 0, opacity: 1, duration: ${enter.toFixed(3)}, ease: "power3.out" }, ${p.start.toFixed(3)});
tl.to(".${cls}__bar", { opacity: 0, duration: ${exit.toFixed(3)}, ease: "power2.in" }, ${exitAt.toFixed(3)});
`.trim();

  return { html, css, js };
}
