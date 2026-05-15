import type { Palette, FontPair } from "@hyperframe-editor/core";
import type { BlockFragment } from "./index.js";
import { escapeHtml, escapeCss } from "../util/escape.js";

export interface QuoteCardProps {
  id: string;
  start: number;
  duration: number;
  trackIndex: number;
  quote: string;
  cite?: string;
  palette: Palette;
  fontPair: FontPair;
}

export function quoteCard(p: QuoteCardProps): BlockFragment {
  const cls = `q-${p.id}`;
  const html = `
<div class="clip ${cls}"
     data-clip-id="${p.id}"
     data-start="${p.start.toFixed(3)}"
     data-duration="${p.duration.toFixed(3)}"
     data-track-index="${p.trackIndex}">
  <blockquote class="${cls}__q">“${escapeHtml(p.quote)}”</blockquote>
  ${p.cite ? `<cite class="${cls}__c">${escapeHtml(p.cite)}</cite>` : ""}
</div>`.trim();

  const css = `
.${cls} {
  position: absolute; inset: 0;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  background: linear-gradient(160deg, ${escapeCss(p.palette.bg)}, ${escapeCss(p.palette.muted)}30);
  color: ${escapeCss(p.palette.fg)};
  padding: 7%;
  text-align: center;
}
.${cls}__q {
  font-family: "${escapeCss(p.fontPair.display)}", serif;
  font-size: clamp(36px, 5vw, 90px);
  line-height: 1.18;
  letter-spacing: -0.005em;
  opacity: 0;
}
.${cls}__c {
  margin-top: 1.4em;
  font-family: "${escapeCss(p.fontPair.body)}", sans-serif;
  font-size: clamp(18px, 1.8vw, 28px);
  font-style: normal;
  color: ${escapeCss(p.palette.accent)};
  letter-spacing: 0.06em;
  text-transform: uppercase;
  opacity: 0;
}`.trim();

  const enter1 = Math.min(0.55, p.duration * 0.22);
  const enter2 = enter1 + 0.25;
  const exit = Math.min(0.4, p.duration * 0.18);
  const exitAt = p.start + p.duration - exit;
  const js = `
tl.fromTo(".${cls}__q", { y: 22, opacity: 0 }, { y: 0, opacity: 1, duration: ${enter1.toFixed(3)}, ease: "power3.out" }, ${p.start.toFixed(3)});
${p.cite ? `tl.fromTo(".${cls}__c", { y: 12, opacity: 0 }, { y: 0, opacity: 1, duration: 0.32, ease: "power3.out" }, ${(p.start + enter2).toFixed(3)});` : ""}
tl.to(".${cls}", { opacity: 0, duration: ${exit.toFixed(3)}, ease: "power2.in" }, ${exitAt.toFixed(3)});
`.trim();

  return { html, css, js };
}
