import type { Palette, FontPair } from "@hyperframe-editor/core";
import type { BlockFragment } from "./index.js";
import { escapeHtml, escapeCss } from "../util/escape.js";

export interface LogoBugProps {
  id: string;
  start: number;
  duration: number;
  trackIndex: number;
  text: string;
  /** Corner: "tl" | "tr" | "bl" | "br". Default "br". */
  corner?: "tl" | "tr" | "bl" | "br";
  palette: Palette;
  fontPair: FontPair;
}

export function logoBug(p: LogoBugProps): BlockFragment {
  const cls = `bug-${p.id}`;
  const c = p.corner ?? "br";
  const pos: Record<string, string> = {
    tl: "top: 4%; left: 4%;",
    tr: "top: 4%; right: 4%;",
    bl: "bottom: 4%; left: 4%;",
    br: "bottom: 4%; right: 4%;",
  };

  const html = `
<div class="clip ${cls}"
     data-clip-id="${p.id}"
     data-start="${p.start.toFixed(3)}"
     data-duration="${p.duration.toFixed(3)}"
     data-track-index="${p.trackIndex}">
  <div class="${cls}__bug">${escapeHtml(p.text)}</div>
</div>`.trim();

  const css = `
.${cls} { position: absolute; inset: 0; pointer-events: none; }
.${cls}__bug {
  position: absolute; ${pos[c]}
  font-family: "${escapeCss(p.fontPair.body)}", sans-serif;
  font-size: clamp(14px, 1.4vw, 22px);
  color: ${escapeCss(p.palette.fg)};
  background: ${escapeCss(p.palette.bg)}aa;
  border: 1px solid ${escapeCss(p.palette.accent)}66;
  padding: 0.4em 0.8em;
  border-radius: 999px;
  letter-spacing: 0.04em;
  opacity: 0;
}`.trim();

  const enter = Math.min(0.3, p.duration * 0.1);
  const exit = Math.min(0.3, p.duration * 0.12);
  const exitAt = p.start + p.duration - exit;
  const js = `
tl.fromTo(".${cls}__bug", { opacity: 0 }, { opacity: 1, duration: ${enter.toFixed(3)}, ease: "power2.out" }, ${p.start.toFixed(3)});
tl.to(".${cls}__bug", { opacity: 0, duration: ${exit.toFixed(3)}, ease: "power2.in" }, ${exitAt.toFixed(3)});
`.trim();

  return { html, css, js };
}
