import type { Palette, FontPair } from "@hyperframe-editor/core";
import type { BlockFragment } from "./index.js";
import { escapeHtml, escapeCss } from "../util/escape.js";

export interface EndCardProps {
  id: string;
  start: number;
  duration: number;
  trackIndex: number;
  cta: string;
  handle?: string;
  palette: Palette;
  fontPair: FontPair;
}

export function endCard(p: EndCardProps): BlockFragment {
  const cls = `end-${p.id}`;
  const html = `
<div class="clip ${cls}"
     data-clip-id="${p.id}"
     data-start="${p.start.toFixed(3)}"
     data-duration="${p.duration.toFixed(3)}"
     data-track-index="${p.trackIndex}">
  <div class="${cls}__cta">${escapeHtml(p.cta)}</div>
  ${p.handle ? `<div class="${cls}__handle">${escapeHtml(p.handle)}</div>` : ""}
</div>`.trim();

  const css = `
.${cls} {
  position: absolute; inset: 0;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  background: ${escapeCss(p.palette.bg)};
  color: ${escapeCss(p.palette.fg)};
  gap: 0.5em;
}
.${cls}__cta {
  font-family: "${escapeCss(p.fontPair.display)}", system-ui, sans-serif;
  font-size: clamp(64px, 11vw, 180px);
  color: ${escapeCss(p.palette.accent)};
  text-align: center;
}
.${cls}__handle {
  font-family: "${escapeCss(p.fontPair.body)}", system-ui, sans-serif;
  font-size: clamp(24px, 2.6vw, 48px);
  opacity: 0.8;
}
`.trim();

  const enter = Math.min(0.4, p.duration * 0.3);
  const js = `
{
  const cta = document.querySelector(".${cls}__cta");
  if (cta) {
    tl.fromTo(cta, { scale: 0.85, opacity: 0 }, { scale: 1, opacity: 1, duration: ${enter.toFixed(3)}, ease: "back.out(1.6)" }, ${p.start.toFixed(3)});
  }
}
`.trim();

  return { html, css, js };
}
