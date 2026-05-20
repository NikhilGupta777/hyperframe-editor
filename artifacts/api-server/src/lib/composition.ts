// @ts-ignore
import type { Composition } from "@hyperframe-editor/core";

/**
 * DEV-MODE ONLY: compositions are stored in process memory.
 * They are intentionally ephemeral — a server restart clears them.
 * For production persistence, replace these Maps with DB/object-storage calls.
 */
const ephemeralAst = new Map<string, Composition>();
const ephemeralHtml = new Map<string, string>();

// GSAP CDN — same URL referenced in official HyperFrames docs
const GSAP_CDN_SCRIPT = `<script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.2/gsap.min.js"></script>`;

/**
 * Robust preview auto-play shim.
 * HyperFrames spec requires paused:true on GSAP timelines so the renderer
 * can seek frame-by-frame. In browser preview we play them manually.
 *
 * Strategy:
 *  1. Attempt .seek(0).play() on all window.__timelines at 50ms and 300ms.
 *  2. After 1s, if any .clip element is still invisible (opacity < 0.1),
 *     force all clips visible as a hard fallback.
 * This covers: slow CDN loads, wrong timeline keys, missing timelines.
 */
const AUTO_PLAY_SHIM = `<script id="__hf-preview-shim">
(function() {
  function fitRootToViewport() {
    var root = document.querySelector('[data-composition-id]');
    if (!root) return;
    var w = Number(root.getAttribute('data-width')) || root.offsetWidth || 1080;
    var h = Number(root.getAttribute('data-height')) || root.offsetHeight || 1920;
    var scale = Math.min(window.innerWidth / w, window.innerHeight / h);
    document.documentElement.style.margin = '0';
    document.documentElement.style.overflow = 'hidden';
    document.body.style.margin = '0';
    document.body.style.width = '100vw';
    document.body.style.height = '100vh';
    document.body.style.overflow = 'hidden';
    document.body.style.background = document.body.style.background || '#000';
    root.style.width = w + 'px';
    root.style.height = h + 'px';
    root.style.position = 'absolute';
    root.style.left = '50%';
    root.style.top = '50%';
    root.style.transformOrigin = 'center center';
    if (!root.dataset.hfOriginalTransform) {
      root.dataset.hfOriginalTransform = root.style.transform || '';
    }
    var originalTransform = root.dataset.hfOriginalTransform;
    root.style.transform = 'translate(-50%, -50%) scale(' + scale + ')' +
      (originalTransform ? ' ' + originalTransform : '');
  }
  function playAllTimelines() {
    var tls = window.__timelines;
    var played = 0;
    if (tls) {
      Object.values(tls).forEach(function(tl) {
        try { tl.seek(0); tl.play(); played++; } catch(e) {}
      });
    }
    return played;
  }
  // Hard fallback: if GSAP animations aren't running, make clips visible directly
  function forceClipsVisible() {
    document.querySelectorAll('.clip').forEach(function(el) {
      var s = el.style;
      s.opacity = '1';
      s.visibility = 'visible';
      s.transform = '';
      s.clipPath = '';
    });
  }
  function init() {
    fitRootToViewport();
    window.addEventListener('resize', fitRootToViewport);
    // First try — timelines may already be set up
    setTimeout(playAllTimelines, 50);
    // Second try — in case GSAP CDN was slow
    setTimeout(playAllTimelines, 300);
    // Final safety net — only force clips visible when NO timelines are registered.
    // If timelines exist, GSAP is controlling visibility; clips mid-animation are
    // intentionally invisible (e.g. data-start=5s at t=1s). Only override when
    // GSAP never loaded / never registered any timelines at all.
    setTimeout(function() {
      var clips = document.querySelectorAll('.clip');
      if (clips.length === 0) return;
      var tls = window.__timelines;
      var hasTimelines = tls && Object.keys(tls).length > 0;
      if (hasTimelines) return; // GSAP is in control — trust it
      // No timelines at all: GSAP failed to load or compose; force clips visible
      forceClipsVisible();
    }, 1200);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
  // Allow the reload button to replay
  window.__hfPreviewPlay = function() {
    playAllTimelines();
  };
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
  const idMatch  = /data-composition-id="([^"]+)"/.exec(html);
  const wMatch   = /data-width="([\d.]+)"/.exec(html);
  const hMatch   = /data-height="([\d.]+)"/.exec(html);
  const durMatch = /data-duration="([\d.]+)"/.exec(html);
  return {
    compositionId: idMatch?.[1] ?? "composition",
    width:         wMatch  ? parseInt(wMatch[1]!,  10) : 1080,
    height:        hMatch  ? parseInt(hMatch[1]!,  10) : 1920,
    duration:      durMatch ? parseFloat(durMatch[1]!) : 0,
  };
}

/**
 * Count .clip elements and compute max-end from data-start + data-duration.
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
  const hasGsap = /gsap|cdnjs\.cloudflare\.com\/ajax\/libs\/gsap/.test(html);
  if (!hasGsap) {
    html = html.replace(/<\/head>/i, `${GSAP_CDN_SCRIPT}\n</head>`);
  }
  if (!html.includes("__hf-preview-shim")) {
    html = html.replace(/<\/body>/i, `${AUTO_PLAY_SHIM}\n</body>`);
  }
  return html;
}

function replaceOrAddAttr(tag: string, attr: string, value: string): string {
  const attrRe = new RegExp(`\\s${attr}="[^"]*"`);
  if (attrRe.test(tag)) return tag.replace(attrRe, ` ${attr}="${value}"`);
  return tag.replace(/>$/, ` ${attr}="${value}">`);
}

function replaceRootStyleDimensions(html: string, canvas: CanvasHint): string {
  return html.replace(/(#root\s*\{)([^}]*)\}/i, (_match, open: string, body: string) => {
    const cleaned = String(body)
      .replace(/width\s*:\s*[^;]+;?/i, "")
      .replace(/height\s*:\s*[^;]+;?/i, "")
      .trim();
    return `${open} width:${canvas.width}px; height:${canvas.height}px; ${cleaned}}`;
  });
}

export function normalizeHtmlForCanvas(rawHtml: string, canvas: CanvasHint): string {
  let html = rawHtml.replace(/<([a-z][\w:-]*)\b(?=[^>]*data-composition-id=)[^>]*>/i, (tag) => {
    let next = String(tag);
    next = replaceOrAddAttr(next, "data-width", String(canvas.width));
    next = replaceOrAddAttr(next, "data-height", String(canvas.height));
    next = replaceOrAddAttr(next, "data-start", "0");
    return next;
  });
  html = replaceRootStyleDimensions(html, canvas);
  return html;
}

export interface CanvasHint {
  width: number;
  height: number;
  fps: number;
}

function buildPlaceholderHtml(
  projectId = "placeholder",
  canvas: CanvasHint = { width: 1080, height: 1920, fps: 30 },
): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <style>
    body { margin:0; background:#0b0f17; color:#f5f7fb;
           font-family:system-ui,sans-serif;
           width:100vw; height:100vh; overflow:hidden; }
    #root { width:${canvas.width}px; height:${canvas.height}px; position:relative; overflow:hidden;
            display:flex; align-items:center; justify-content:center; flex-direction:column; gap:0.5rem; }
    .hint { font-size:1.1rem; font-weight:700; }
    .sub  { font-size:0.8rem; opacity:0.5; }
  </style>
</head>
<body>
  <div id="root"
    data-composition-id="${projectId}"
    data-start="0"
    data-width="${canvas.width}"
    data-height="${canvas.height}"
    data-duration="0">
    <div class="hint">No composition yet</div>
    <div class="sub">${canvas.width}x${canvas.height} - Click Generate to create one</div>
  </div>
</body>
</html>`;
}

function buildPlaceholderAst(projectId: string, canvas?: CanvasHint): Composition {
  // @ts-ignore
  return {
    id: projectId,
    canvas: canvas ?? { width: 1080, height: 1920, fps: 30 },
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
 * - Replace @hyperframes/core CDN refs with local path
 * - Rewrite relative asset paths to absolute API URLs
 * - Inject GSAP CDN if missing
 * - Inject robust preview auto-play shim
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

/**
 * Get or create a placeholder composition for a project.
 * @param projectId  The project UUID
 * @param canvas     Optional canvas hint from the project's preset — used so the
 *                   placeholder has the correct aspect ratio before first generation.
 */
export async function getOrBootstrapComposition(
  projectId: string,
  canvas?: CanvasHint,
): Promise<BootstrappedComposition> {
  const existingJson = ephemeralAst.get(projectId);
  const existingHtml = ephemeralHtml.get(projectId);

  if (existingJson && existingHtml) {
    return { composition: existingJson, html: existingHtml, bootstrapped: false };
  }

  const composition = buildPlaceholderAst(projectId, canvas);
  const html = buildPlaceholderHtml(projectId, canvas);
  ephemeralAst.set(projectId, composition);
  ephemeralHtml.set(projectId, html);
  return { composition, html, bootstrapped: true };
}

export async function saveCompositionHtml(
  projectId: string,
  rawHtml: string,
  canvasHint?: CanvasHint,
): Promise<void> {
  const normalizedHtml = canvasHint ? normalizeHtmlForCanvas(rawHtml, canvasHint) : rawHtml;
  const { width, height, duration, compositionId } = parseRootAttrs(normalizedHtml);
  const { clipCount, maxEnd } = parseClipsFromHtml(normalizedHtml);

  const composition: Composition = (
    ephemeralAst.get(projectId) ?? buildPlaceholderAst(projectId)
  ) as Composition;
  // @ts-ignore
  composition.canvas    = { width, height, fps: 30 };
  // @ts-ignore
  composition.duration  = duration > 0 ? duration : maxEnd;
  // @ts-ignore
  composition.id        = compositionId || projectId;

  ephemeralAst.set(projectId, composition);
  ephemeralHtml.set(projectId, normalizedHtml);
  void clipCount;
}

export async function saveComposition(
  projectId: string,
  composition: Composition,
): Promise<{ html: string }> {
  const existing = ephemeralHtml.get(projectId) ?? buildPlaceholderHtml(projectId, composition.canvas);
  ephemeralAst.set(projectId, composition);
  ephemeralHtml.set(projectId, existing);
  return { html: existing };
}
