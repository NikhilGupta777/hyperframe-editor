/**
 * Transition library. Each transition produces a CSS+JS fragment that the
 * builder splices in between two adjacent clips on the same track. They never
 * touch the clip elements directly — they sit on a transition layer (z-index
 * > clips) so they don't perturb the clips' own animations.
 *
 * Phase 1 ships three transitions: Flash, Wipe, and CrossFade. Each is
 * deterministic, finite, and uses only paused tl.fromTo tweens (so they
 * conform to the composition contract gate G2 enforces).
 */

export interface TransitionFragment {
  html: string;
  css: string;
  js: string;
}

export interface TransitionProps {
  id: string;
  /** Absolute time at which the transition begins (typically the outgoing clip's end - duration). */
  start: number;
  duration: number;
  /** Hex color the flash/wipe uses; defaults to white. */
  color?: string;
}

export function transitionFlash(p: TransitionProps): TransitionFragment {
  const cls = `tx-flash-${p.id}`;
  const color = p.color ?? "#ffffff";
  const html = `<div class="clip ${cls}"
    data-clip-id="${p.id}"
    data-start="${p.start.toFixed(3)}"
    data-duration="${p.duration.toFixed(3)}"
    data-track-index="99"></div>`;
  const css = `.${cls} { position: absolute; inset: 0; background: ${color}; opacity: 0; pointer-events: none; z-index: 99; }`;
  const half = p.duration / 2;
  const js = `
tl.fromTo(".${cls}", { opacity: 0 }, { opacity: 1, duration: ${half.toFixed(3)}, ease: "power3.out" }, ${p.start.toFixed(3)});
tl.to(".${cls}", { opacity: 0, duration: ${half.toFixed(3)}, ease: "power3.in" }, ${(p.start + half).toFixed(3)});
`.trim();
  return { html, css, js };
}

export function transitionWipe(p: TransitionProps): TransitionFragment {
  const cls = `tx-wipe-${p.id}`;
  const color = p.color ?? "#000000";
  const html = `<div class="clip ${cls}"
    data-clip-id="${p.id}"
    data-start="${p.start.toFixed(3)}"
    data-duration="${p.duration.toFixed(3)}"
    data-track-index="99"></div>`;
  const css = `.${cls} { position: absolute; inset: 0 100% 0 0; background: ${color}; pointer-events: none; z-index: 99; }`;
  const half = p.duration / 2;
  const js = `
tl.fromTo(".${cls}", { right: "100%" }, { right: "0%", duration: ${half.toFixed(3)}, ease: "power3.inOut" }, ${p.start.toFixed(3)});
tl.fromTo(".${cls}", { left: "0%" }, { left: "100%", duration: ${half.toFixed(3)}, ease: "power3.inOut" }, ${(p.start + half).toFixed(3)});
`.trim();
  return { html, css, js };
}

export function transitionCrossFade(p: TransitionProps): TransitionFragment {
  // CrossFade fades a black overlay; the underlying clips animate independently.
  // Cleaner than fading the clips themselves because we don't need to know
  // which clips are involved.
  const cls = `tx-cf-${p.id}`;
  const html = `<div class="clip ${cls}"
    data-clip-id="${p.id}"
    data-start="${p.start.toFixed(3)}"
    data-duration="${p.duration.toFixed(3)}"
    data-track-index="99"></div>`;
  const css = `.${cls} { position: absolute; inset: 0; background: #000; opacity: 0; pointer-events: none; z-index: 99; }`;
  const half = p.duration / 2;
  const js = `
tl.fromTo(".${cls}", { opacity: 0 }, { opacity: 1, duration: ${half.toFixed(3)}, ease: "power2.inOut" }, ${p.start.toFixed(3)});
tl.to(".${cls}", { opacity: 0, duration: ${half.toFixed(3)}, ease: "power2.inOut" }, ${(p.start + half).toFixed(3)});
`.trim();
  return { html, css, js };
}

export const TRANSITIONS = {
  flash: transitionFlash,
  wipe: transitionWipe,
  crossfade: transitionCrossFade,
} as const;

export type TransitionName = keyof typeof TRANSITIONS;
