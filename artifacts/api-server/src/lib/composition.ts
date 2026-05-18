// @ts-ignore
import type { Composition } from "@hyperframe-editor/core";

const ephemeralAst = new Map<string, Composition>();
const ephemeralHtml = new Map<string, string>();

function buildPlaceholderComposition(projectId: string): Composition {
  // @ts-ignore
  const composition: Composition = {
    id: projectId,
    canvas: { width: 1080, height: 1920, fps: 30 },
    duration: 4,
    assets: [],
    variables: { placeholder: true },
    clips: [
      {
        id: "placeholder-hook",
        kind: "block",
        block: "HookTitle",
        trackIndex: 0,
        start: 0,
        duration: 2,
        playbackOffset: 0,
        props: {
          text: "Untitled project",
          subtext: "Click Render to begin",
        },
      },
      {
        id: "placeholder-end",
        kind: "block",
        block: "EndCard",
        trackIndex: 0,
        start: 2,
        duration: 2,
        playbackOffset: 0,
        props: { cta: "Render", handle: "@hyperframeeditor" },
      },
    ],
  };
  return composition;
}

function buildPlaceholderHtml(projectId: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Composition Preview</title>
  <style>
    body { margin: 0; background: #0b0f17; color: #f5f7fb; font-family: 'Inter', sans-serif; 
           display: flex; align-items: center; justify-content: center; height: 100vh; flex-direction: column; }
    .hint { font-size: 1.25rem; font-weight: 700; margin-bottom: 0.5rem; }
    .sub { font-size: 0.875rem; opacity: 0.6; }
  </style>
</head>
<body>
  <div class="hint">Untitled project</div>
  <div class="sub">Click Render to begin</div>
  <script src="/api/preview/runtime.js"></script>
</body>
</html>`;
}

const HF_RUNTIME_CDN_RE =
  /https?:\/\/cdn\.jsdelivr\.net\/npm\/@hyperframes\/core(@[^/]+)?\/dist\/hyperframe\.runtime\.iife\.js/g;
const ASSET_REF_RE = /(<(?:img|video|audio|source|link)\b[^>]*?\s(?:src|href)=")assets\//gi;

export function rewriteHtmlForBrowser(html: string, projectId: string): string {
  const runtimeUrl = "/api/preview/runtime.js";
  const assetPrefix = `/api/projects/${encodeURIComponent(projectId)}/assets/`;
  return html
    .replace(HF_RUNTIME_CDN_RE, runtimeUrl)
    .replace(ASSET_REF_RE, `$1${assetPrefix}`);
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

  const composition = buildPlaceholderComposition(projectId);
  const html = buildPlaceholderHtml(projectId);
  ephemeralAst.set(projectId, composition);
  ephemeralHtml.set(projectId, html);
  return { composition, html, bootstrapped: true };
}

export async function saveComposition(
  projectId: string,
  composition: Composition,
): Promise<{ html: string }> {
  const html = buildPlaceholderHtml(projectId);
  ephemeralAst.set(projectId, composition);
  ephemeralHtml.set(projectId, html);
  return { html };
}

export async function saveCompositionHtml(projectId: string, html: string): Promise<void> {
  const existing = ephemeralAst.get(projectId) ?? (await getOrBootstrapComposition(projectId)).composition;
  ephemeralAst.set(projectId, existing);
  ephemeralHtml.set(projectId, html);
}
