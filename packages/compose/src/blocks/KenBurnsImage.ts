import type { BlockFragment } from "./index.js";
import { escapeCss } from "../util/escape.js";

export interface KenBurnsImageProps {
  id: string;
  start: number;
  duration: number;
  trackIndex: number;
  /** Local relative path or oci:// URI. The renderer mounts oci:// to file:// at render time. */
  src: string;
  /** "in" zooms in (108% → 100%); "out" zooms out (100% → 108%). */
  direction?: "in" | "out";
}

export function kenBurnsImage(p: KenBurnsImageProps): BlockFragment {
  const cls = `kb-${p.id}`;
  const dir = p.direction ?? "in";

  const html = `
<div class="clip ${cls}"
     data-clip-id="${p.id}"
     data-start="${p.start.toFixed(3)}"
     data-duration="${p.duration.toFixed(3)}"
     data-track-index="${p.trackIndex}">
  <img class="${cls}__img" src="${escapeCss(p.src)}" alt="" />
</div>`.trim();

  const css = `
.${cls} { position: absolute; inset: 0; overflow: hidden; }
.${cls}__img {
  position: absolute; inset: 0;
  width: 100%; height: 100%;
  object-fit: cover;
  will-change: transform;
}`.trim();

  const fromScale = dir === "in" ? 1.08 : 1.0;
  const toScale = dir === "in" ? 1.0 : 1.08;
  const js = `
tl.fromTo(".${cls}__img", { scale: ${fromScale} }, { scale: ${toScale}, duration: ${p.duration.toFixed(3)}, ease: "none" }, ${p.start.toFixed(3)});
`.trim();

  return { html, css, js };
}
