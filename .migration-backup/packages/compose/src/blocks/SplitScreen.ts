import type { Palette } from "@hyperframe-editor/core";
import type { BlockFragment } from "./index.js";
import { escapeCss } from "../util/escape.js";

export interface SplitScreenProps {
  id: string;
  start: number;
  duration: number;
  trackIndex: number;
  /** Two image/video sources to display side by side. */
  left: { src: string; kind?: "image" | "video" };
  right: { src: string; kind?: "image" | "video" };
  /** Direction the split is biased; "vertical" = top/bottom, "horizontal" = left/right. */
  direction?: "horizontal" | "vertical";
  palette: Palette;
}

export function splitScreen(p: SplitScreenProps): BlockFragment {
  const cls = `split-${p.id}`;
  const isVert = p.direction === "vertical";

  const tag = (s: { src: string; kind?: "image" | "video" }, side: "a" | "b") => {
    const kind = s.kind ?? "image";
    if (kind === "video") {
      return `<video class="${cls}__${side}" src="${escapeCss(s.src)}" muted playsinline preload="auto"></video>`;
    }
    return `<img class="${cls}__${side}" src="${escapeCss(s.src)}" alt="" />`;
  };

  const html = `
<div class="clip ${cls}"
     data-clip-id="${p.id}"
     data-start="${p.start.toFixed(3)}"
     data-duration="${p.duration.toFixed(3)}"
     data-track-index="${p.trackIndex}">
  ${tag(p.left, "a")}
  ${tag(p.right, "b")}
</div>`.trim();

  const css = `
.${cls} { position: absolute; inset: 0; overflow: hidden; background: ${escapeCss(p.palette.bg)}; }
.${cls}__a, .${cls}__b {
  position: absolute;
  width: ${isVert ? "100%" : "50%"};
  height: ${isVert ? "50%" : "100%"};
  object-fit: cover;
}
.${cls}__a { ${isVert ? "top: 0; left: 0;" : "top: 0; left: 0;"} }
.${cls}__b { ${isVert ? "bottom: 0; left: 0;" : "top: 0; right: 0;"} }
`.trim();

  // Subtle parallax: each side drifts 2% over the clip.
  const js = `
tl.fromTo(".${cls}__a", { ${isVert ? "y: '-2%'" : "x: '-2%'"} }, { ${isVert ? "y: '0%'" : "x: '0%'"}, duration: ${p.duration.toFixed(3)}, ease: "none" }, ${p.start.toFixed(3)});
tl.fromTo(".${cls}__b", { ${isVert ? "y: '2%'" : "x: '2%'"} }, { ${isVert ? "y: '0%'" : "x: '0%'"}, duration: ${p.duration.toFixed(3)}, ease: "none" }, ${p.start.toFixed(3)});
`.trim();

  return { html, css, js };
}
