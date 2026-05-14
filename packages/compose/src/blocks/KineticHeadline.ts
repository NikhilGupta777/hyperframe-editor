import type { Palette, FontPair } from "@hyperframe-editor/core";
import type { BlockFragment } from "./index.js";
import { escapeHtml, escapeCss } from "../util/escape.js";

export interface KineticHeadlineProps {
  id: string;
  start: number;
  duration: number;
  trackIndex: number;
  /** Words are revealed one at a time, ~120ms apart. */
  words: string[];
  palette: Palette;
  fontPair: FontPair;
}

export function kineticHeadline(p: KineticHeadlineProps): BlockFragment {
  const cls = `kin-${p.id}`;
  const wordSpans = p.words
    .map((w, i) => `<span class="${cls}__w" data-i="${i}">${escapeHtml(w)}</span>`)
    .join(" ");
  const html = `
<div class="clip ${cls}"
     data-clip-id="${p.id}"
     data-start="${p.start.toFixed(3)}"
     data-duration="${p.duration.toFixed(3)}"
     data-track-index="${p.trackIndex}">
  <div class="${cls}__words">${wordSpans}</div>
</div>`.trim();

  const css = `
.${cls} {
  position: absolute; inset: 0;
  display: flex; align-items: center; justify-content: center;
  background: ${escapeCss(p.palette.bg)};
  color: ${escapeCss(p.palette.fg)};
}
.${cls}__words {
  font-family: "${escapeCss(p.fontPair.display)}", system-ui, sans-serif;
  font-size: clamp(56px, 9vw, 160px);
  line-height: 1.05;
  text-align: center;
  padding: 0 7%;
}
.${cls}__w { display: inline-block; opacity: 0; transform: translateY(28px); }
`.trim();

  // Stagger by 120ms; finish reveal in the first 60% of the clip; quick fade-out at the end.
  const stagger = 0.12;
  const totalReveal = Math.min(p.duration * 0.6, p.words.length * stagger);
  const exit = Math.min(0.4, p.duration * 0.2);
  const lines: string[] = [];
  p.words.forEach((_, i) => {
    const at = (p.start + Math.min(i * stagger, totalReveal)).toFixed(3);
    lines.push(
      `tl.fromTo(document.querySelectorAll(".${cls}__w")[${i}], { y: 28, opacity: 0 }, { y: 0, opacity: 1, duration: 0.32, ease: "power3.out" }, ${at});`,
    );
  });
  lines.push(
    `tl.to(document.querySelector(".${cls}__words"), { opacity: 0, duration: ${exit.toFixed(3)}, ease: "power2.in" }, ${(p.start + p.duration - exit).toFixed(3)});`,
  );

  return { html, css, js: lines.join("\n") };
}
