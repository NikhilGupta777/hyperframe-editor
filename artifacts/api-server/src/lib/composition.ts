// @ts-ignore
import type { Composition } from "@hyperframe-editor/core";

/**
 * DEV-MODE ONLY: compositions are stored in process memory.
 * They are intentionally ephemeral — a server restart clears them.
 * For production persistence, replace these Maps with DB/object-storage calls.
 */
const ephemeralAst = new Map<string, Composition>();
const ephemeralHtml = new Map<string, string>();

// GSAP CDN — using the same CDN referenced in official HyperFrames docs
const GSAP_CDN_SCRIPT = `<script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.2/gsap.min.js"></script>`;

/**
 * Auto-play shim: injected into the browser preview iframe.
 * HyperFrames requires paused:true for deterministic rendering.
 * In browser preview (no renderer seeking), we play the timelines manually.
 * Uses @hyperframes/player semantics: dispatches from window.__timelines.
 */
const AUTO_PLAY_SHIM = `<script id="__hf-preview-shim">
(function() {
  function playAllTimelines() {
    var tls = window.__timelines;
    if (!tls) return;
    Object.values(tls).forEach(function(tl) {
      try { tl.seek(0); tl.play(); } catch(e) {}
    });
  }
  // Wait for GSAP + all scripts to be ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() { setTimeout(playAllTimelines, 80); });
  } else {
    setTimeout(playAllTimelines, 80);
  }
  // Expose for manual replay (reload button)
  window.__hfPreviewPlay = playAllTimelines;
})();
</script>`;

/**
 * Parse data-width, data-height, data-duration, data-composition-id
 * from the HyperFrames root element.
 */
export function parseRootAttrs(html: string): {
  width: number;
  height: number;
  duration: number;
  compositionId: string;
} {
  const idMatch    = /data-composition-id="([^"]+)"/.exec(html);
  const wMatch     = /data-width="([\d.]+)"/.exec(html);
  const hMatch     = /data-height="([\d.]+)"/.exec(html);
  const durMatch   = /data-duration="([\d.]+)"/.exec(html);

  return {
    compositionId: idMatch?.[1] ?? "composition",
    width:         wMatch  ? parseInt(wMatch[1]!,  10) : 1080,
    height:        hMatch  ? parseInt(hMatch[1]!,  10) : 1920,
    duration:      durMatch ? parseFloat(durMatch[1]!) : 0,
  };
}

/**
 * Count clips and compute max-end from data-start + data-duration attrs
 * (fallback when root data-duration is absent).
 */
export function parseClipsFromHtml(html: string): { clipCount: number; maxEnd: number } {
  let clipCount = 0;
  let maxEnd = 0;
  const tagRe = /<[^>]+class="[^"]*\bclip\b[^"]*"[^>]*>/g;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(html)) !== null) {
    clipCount++;
    const startM = /data-start="([\d.]+)"/.exec(m[0]!);
    const durM   = /data-duration="([\d.]+)"/.exec(m[0]!);
    if (startM && durM) {
      const end = parseFloat(startM[1]!) + parseFloat(durM[1]!);
      if (end > maxEnd) maxEnd = end;
    }
  }
  return { clipCount, maxEnd };
}

function injectDepsIfMissing(html: string): string {
  // Inject GSAP CDN if not already present
  const hasGsap = /gsap|cdnjs\.cloudflare\.com\/ajax\/libs\/gsap/.test(html);
  if (!hasGsap) {
    html = html.replace(/<\/head>/i, `${GSAP_CDN_SCRIPT}\n</head>`);
  }
  // Inject preview shim if not already present
  if (!html.includes("__hf-preview-shim")) {
    html = html.replace(/<\/body>/i, `${AUTO_PLAY_SHIM}\n</body>`);
  }
  return html;
}

function buildPlaceholderHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <style>
    body { margin: 0; background: #0b0f17; color: #f5f7fb;
           font-family: system-ui, sans-serif;
           display: flex; align-items: center; justify-content: center;
           height: 100vh; flex-direction: column; gap: 0.5rem; }
    .hint { font-size: 1.1rem; font-weight: 700; }
    .sub  { font-size: 0.8rem; opacity: 0.5; }
  </style>
</head>
<body>
  <div class="hint">No composition yet</div>
  <div class="sub">Click Generate to create one</div>
</body>
</html>`;
}

function buildPlaceholderAst(projectId: string): Composition {
  // @ts-ignore
  return {
    id: projectId,
    canvas: { width: 1080, height: 1920, fps: 30 },
    duration: 0,
    assets: [],
    variables: { placeholder: true },
    clips: [],
  } as Composition;
}

const HF_RUNTIME_CDN_RE =
  /https?:\/\/cdn\.jsdelivr\.net\/npm\/@hyperframes\/core(@[^/]+)?\/dist\/hyperframe\.runtime\.iife\.js/g;

/**
 * Rewrite HTML for browser preview:
 * - Replace @hyperframes/core CDN refs with local path (if @hyperframes/core is installed)
 * - Rewrite relative asset paths to absolute API URLs
 * - Inject GSAP CDN if missing
 * - Inject preview auto-play shim (timelines are paused:true for renderer;
 *   the shim plays them in the browser preview)
 */
export function rewriteHtmlForBrowser(rawHtml: string, projectId: string): string {
  const assetPrefix = `/api/projects/${encodeURIComponent(projectId)}/assets/`;
  let out = rawHtml
    .replace(HF_RUNTIME_CDN_RE, "/api/preview/runtime.js")
    .replace(
      /(<(?:img|video|audio|source|link)\b[^>]*?\s(?:src|href)=")assets\//gi,
      `$1${assetPrefix}`,
    );
  out = injectDepsIfMissing(out);
  return out;
}

export interface BootstrappedComposition {
  composition: Composition;
  html: string;
  bootstrapped: boolean;
}

export async function getOrBootstrapComposition(
  projectId: string,
): Promise<BootstrappedComposition> {
  const existingJson = ephemeralAst.get(projectId);
  const existingHtml = ephemeralHtml.get(projectId);

  if (existingJson && existingHtml) {
    return { composition: existingJson, html: existingHtml, bootstrapped: false };
  }

  const composition = buildPlaceholderAst(projectId);
  const html = buildPlaceholderHtml();
  ephemeralAst.set(projectId, composition);
  ephemeralHtml.set(projectId, html);
  return { composition, html, bootstrapped: true };
}

export async function saveCompositionHtml(projectId: string, rawHtml: string): Promise<void> {
  // Parse canvas + duration from the root element attributes
  const { width, height, duration, compositionId } = parseRootAttrs(rawHtml);
  const { clipCount, maxEnd } = parseClipsFromHtml(rawHtml);

  const composition: Composition = (ephemeralAst.get(projectId) ?? buildPlaceholderAst(projectId)) as Composition;
  // @ts-ignore — update canvas from parsed HTML
  composition.canvas = { width, height, fps: 30 };
  // @ts-ignore
  composition.duration = duration > 0 ? duration : maxEnd;
  // @ts-ignore
  composition.id = compositionId || projectId;

  ephemeralAst.set(projectId, composition);
  ephemeralHtml.set(projectId, rawHtml);
  void clipCount; // used in gate checks via agent-bus
}

export async function saveComposition(
  projectId: string,
  composition: Composition,
): Promise<{ html: string }> {
  const existing = ephemeralHtml.get(projectId) ?? buildPlaceholderHtml();
  ephemeralAst.set(projectId, composition);
  ephemeralHtml.set(projectId, existing);
  return { html: existing };
}
