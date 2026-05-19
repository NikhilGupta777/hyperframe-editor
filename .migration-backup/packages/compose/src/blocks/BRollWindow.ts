import type { Palette } from "@hyperframe-editor/core";
import type { BlockFragment } from "./index.js";
import { escapeCss } from "../util/escape.js";

export interface BRollWindowProps {
  id: string;
  start: number;
  duration: number;
  trackIndex: number;
  /** Source video file or oci:// URI. */
  src: string;
  /** Where to anchor the picture-in-picture window. Default "br". */
  corner?: "tl" | "tr" | "bl" | "br" | "center";
  /** Width as fraction of canvas. Default 0.36. */
  width?: number;
  palette: Palette;
}

export function bRollWindow(p: BRollWindowProps): BlockFragment {
  const cls = `br-${p.id}`;
  const widthPct = ((p.width ?? 0.36) * 100).toFixed(1);
  const corners: Record<string, string> = {
    tl: "top: 5%; left: 5%;",
    tr: "top: 5%; right: 5%;",
    bl: "bottom: 5%; left: 5%;",
    br: "bottom: 5%; right: 5%;",
    center: "top: 50%; left: 50%; transform: translate(-50%, -50%);",
  };

  const html = `
<div class="clip ${cls}"
     data-clip-id="${p.id}"
     data-start="${p.start.toFixed(3)}"
     data-duration="${p.duration.toFixed(3)}"
     data-track-index="${p.trackIndex}">
  <video class="${cls}__pip" muted playsinline preload="auto" src="${escapeCss(p.src)}"></video>
</div>`.trim();

  const css = `
.${cls} { position: absolute; inset: 0; pointer-events: none; }
.${cls}__pip {
  position: absolute; ${corners[p.corner ?? "br"]}
  width: ${widthPct}%;
  border-radius: 14px;
  border: 3px solid ${escapeCss(p.palette.accent)};
  box-shadow: 0 18px 36px rgba(0,0,0,0.45);
  object-fit: cover;
  background: #000;
  opacity: 0;
}
`.trim();

  const enter = Math.min(0.3, p.duration * 0.12);
  const exit = Math.min(0.3, p.duration * 0.12);
  const exitAt = p.start + p.duration - exit;
  const js = `
tl.fromTo(".${cls}__pip", { opacity: 0, scale: 0.94 }, { opacity: 1, scale: 1, duration: ${enter.toFixed(3)}, ease: "back.out(1.4)" }, ${p.start.toFixed(3)});
tl.to(".${cls}__pip", { opacity: 0, duration: ${exit.toFixed(3)}, ease: "power2.in" }, ${exitAt.toFixed(3)});
`.trim();

  return { html, css, js };
}
