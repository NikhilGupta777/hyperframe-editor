/**
 * Smoke test for the composition rewrite logic the preview iframe consumes.
 *
 * The on-disk composition.html (the artifact the worker also feeds Chromium)
 * uses the CDN form of the HyperFrames runtime and references assets with
 * relative `assets/...` paths. Before serving those bytes to the editor
 * iframe we rewrite them to same-origin URLs so the browser can resolve them.
 *
 * This script duplicates the regexes in `apps/web/lib/composition.ts` so we
 * don't pull in the Next runtime here. If the regex shape changes there,
 * mirror it in this file.
 */

const HF_RUNTIME_CDN_RE =
  /https?:\/\/cdn\.jsdelivr\.net\/npm\/@hyperframes\/core(@[^/]+)?\/dist\/hyperframe\.runtime\.iife\.js/g;
const ASSET_REF_RE = /(<(?:img|video|audio|source|link)\b[^>]*?\s(?:src|href)=")assets\//gi;

function rewriteHtmlForBrowser(html, projectId) {
  const runtimeUrl = "/api/preview/runtime.js";
  const assetPrefix = `/api/projects/${encodeURIComponent(projectId)}/assets/`;
  return html
    .replace(HF_RUNTIME_CDN_RE, runtimeUrl)
    .replace(ASSET_REF_RE, `$1${assetPrefix}`);
}

const sample = `<!DOCTYPE html>
<html><head>
<script src="https://cdn.jsdelivr.net/npm/@hyperframes/core/dist/hyperframe.runtime.iife.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@hyperframes/core@0.6.6/dist/hyperframe.runtime.iife.js"></script>
<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
<link href="assets/foo.css" rel="stylesheet">
</head><body>
<img src="assets/cuts.jpg">
<video src="assets/cuts.mp4" data-x="assets/should-not-rewrite"></video>
<audio  SRC="assets/sound.mp3"></audio>
<source src="assets/source.webm">
<a href="assets/should-not-rewrite-anchor">link</a>
</body></html>`;

const out = rewriteHtmlForBrowser(sample, "proj-123");

const checks = [
  ["runtime CDN unversioned replaced", out.includes('<script src="/api/preview/runtime.js">')],
  ["runtime CDN versioned replaced", !out.includes("@hyperframes/core@0.6.6")],
  ["GSAP CDN preserved (gate G7 allowlist)", out.includes("cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js")],
  ["img src rewritten", out.includes('<img src="/api/projects/proj-123/assets/cuts.jpg">')],
  ["video src rewritten", out.includes('<video src="/api/projects/proj-123/assets/cuts.mp4"')],
  ["audio SRC case-insensitive", out.includes('SRC="/api/projects/proj-123/assets/sound.mp3"')],
  ["source src rewritten", out.includes('<source src="/api/projects/proj-123/assets/source.webm"')],
  ["link href rewritten", out.includes('<link href="/api/projects/proj-123/assets/foo.css"')],
  ["data-x preserved (not src/href)", out.includes('data-x="assets/should-not-rewrite"')],
  ["anchor href preserved (anchor not in tag list)", out.includes('href="assets/should-not-rewrite-anchor"')],
];

let pass = 0,
  fail = 0;
for (const [name, ok] of checks) {
  console.log(`  ${ok ? "PASS" : "FAIL"} ${name}`);
  ok ? pass++ : fail++;
}
console.log(`\n${pass}/${pass + fail}`);
if (fail > 0) {
  console.log("\n--- rewritten HTML ---");
  console.log(out);
  process.exit(1);
}
console.log("rewrite smoke OK.");
