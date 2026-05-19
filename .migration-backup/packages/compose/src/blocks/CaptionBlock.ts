import type { Palette, FontPair } from "@hyperframe-editor/core";
import type { BlockFragment } from "./index.js";
import { escapeHtml, escapeCss } from "../util/escape.js";

export interface CaptionLine {
  start: number; // absolute, seconds
  end: number;
  text: string;
}

export interface CaptionBlockProps {
  id: string;
  start: number;
  duration: number;
  trackIndex: number;
  /** Lines must lie inside [start, start+duration]. */
  lines: CaptionLine[];
  /** "tiktok" -> 2-word UPPERCASE chunks; "subtitle" -> standard. */
  style?: "tiktok" | "subtitle";
  palette: Palette;
  fontPair: FontPair;
}

export function captionBlock(p: CaptionBlockProps): BlockFragment {
  const cls = `cap-${p.id}`;
  const isTikTok = p.style !== "subtitle";

  const lineDivs = p.lines
    .map(
      (ln, i) =>
        `<div class="${cls}__l" data-i="${i}">${escapeHtml(
          isTikTok ? ln.text.toUpperCase() : ln.text,
        )}</div>`,
    )
    .join("\n");

  const html = `
<div class="clip ${cls}"
     data-clip-id="${p.id}"
     data-start="${p.start.toFixed(3)}"
     data-duration="${p.duration.toFixed(3)}"
     data-track-index="${p.trackIndex}">
  ${lineDivs}
</div>`.trim();

  const css = `
.${cls} {
  position: absolute; inset: auto 0 14% 0;
  display: flex; align-items: center; justify-content: center;
  pointer-events: none;
}
.${cls}__l {
  position: absolute;
  font-family: "${escapeCss(p.fontPair.display)}", system-ui, sans-serif;
  font-size: clamp(${isTikTok ? "44px, 6vw, 110px" : "30px, 3.4vw, 64px"});
  font-weight: 900;
  text-align: center;
  color: ${escapeCss(p.palette.fg)};
  text-shadow: 0 4px 18px rgba(0,0,0,0.55), 0 0 8px rgba(0,0,0,0.6);
  -webkit-text-stroke: 2px #000;
  padding: 0 6%;
  opacity: 0;
  letter-spacing: -0.01em;
}
`.trim();

  const tweens: string[] = [];
  p.lines.forEach((ln, i) => {
    const fadeIn = Math.min(0.12, (ln.end - ln.start) * 0.2);
    const fadeOut = Math.min(0.12, (ln.end - ln.start) * 0.2);
    const visEnd = ln.end - fadeOut;
    tweens.push(
      `tl.fromTo(document.querySelectorAll(".${cls}__l")[${i}], { y: 18, opacity: 0 }, { y: 0, opacity: 1, duration: ${fadeIn.toFixed(3)}, ease: "power2.out" }, ${ln.start.toFixed(3)});`,
      `tl.to(document.querySelectorAll(".${cls}__l")[${i}], { opacity: 0, duration: ${fadeOut.toFixed(3)}, ease: "power2.in" }, ${visEnd.toFixed(3)});`,
    );
  });

  return { html, css, js: tweens.join("\n") };
}
