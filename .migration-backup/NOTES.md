# Research Notes

Distillation of what we found in six reference repos and on the live web. PLAN.md cites these; this file is the receipts.

The cloned repos live under `research/` (gitignored) for ad-hoc inspection. They are not vendored.

| Local path | Upstream | What it gave us |
| --- | --- | --- |
| `research/hyperframes/` | [heygen-com/hyperframes](https://github.com/heygen-com/hyperframes) | The framework itself: composition format, packages, render pipeline |
| `research/hf-cf-template/` | [heygen-com/hyperframes-cloudflare-template](https://github.com/heygen-com/hyperframes-cloudflare-template) | The cleanest "prompt → MP4" loop in existence (~150 lines). Our MVP ports this directly |
| `research/hf-vercel-template/` | [heygen-com/hyperframes-vercel-template](https://github.com/heygen-com/hyperframes-vercel-template) | Vercel Sandbox rendering pattern + preview proxy + runtime serving |
| `research/vibeframe/` | [vericontext/vibeframe](https://github.com/vericontext/vibeframe) | STORYBOARD/DESIGN markdown plan format; three-lane mental model; tool manifest pattern |
| `research/mcp-video/` | [KyaniteLabs/mcp-video](https://github.com/KyaniteLabs/mcp-video) | Tool-catalog shape: ~80 video-editing tools cleanly grouped (basic / audio / effects / hyperframes / advanced) |
| `research/video-use/` | [browser-use/video-use](https://github.com/browser-use/video-use) | "Don't watch frames, read transcript" pattern for long-video editing |

---

## 1. HyperFrames at a glance

- License: Apache-2.0. Node 22+. FFmpeg required.
- Latest release tracked: v0.6.6 (May 2026 in the repo we cloned).
- Composition is plain HTML + CSS + JS with `data-*` attributes. No React, no DSL.
- Renderer = Chromium (via Puppeteer) seeking by frame + FFmpeg encoding.
- Built for AI agents: ships skills, slash commands, plugin manifests for Claude Code / Cursor / Codex.

### 1.1 Packages

| Package | Role |
| --- | --- |
| `@hyperframes/core` | types, parsers, **lint** (`@hyperframes/core/lint`), runtime IIFE injected into compositions |
| `@hyperframes/engine` | low-level seek-by-frame capture engine (Puppeteer + FFmpeg) |
| `@hyperframes/producer` | full pipeline (capture + encode + audio mix) **plus** an HTTP server (Hono) |
| `@hyperframes/studio` | React 19 / Vite / Zustand / CodeMirror visual editor — heavy, opinionated, not embeddable as-is |
| `@hyperframes/player` | embeddable web component `<hyperframes-player>` — preview anywhere |
| `@hyperframes/shader-transitions` | WebGL shader transitions library |

### 1.2 Composition format (what the agent must produce)

Minimal valid composition (paraphrased from `research/hf-cf-template/src/lib/hyperframes-skill.ts`):

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=1920, height=1080">
  <link href="https://fonts.googleapis.com/css2?family=Font:wght@400;700&display=block" rel="stylesheet">
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    html,body{width:1920px;height:1080px;overflow:hidden}
    .composition{position:relative;width:100%;height:100%}
  </style>
</head>
<body>
  <div class="composition"
       data-composition-id="main"
       data-width="1920" data-height="1080"
       data-start="0" data-duration="6.00">
    <!-- clips: each must have class="clip" + data-start + data-duration + data-track-index -->
  </div>
  <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/@hyperframes/core/dist/hyperframe.runtime.iife.js"></script>
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    /* every tween attached to tl, never bare gsap.to() */
    window.__timelines["main"] = tl;
  </script>
</body>
</html>
```

**Hard rules** (lint-enforced):

- Root `<div>` with `data-composition-id`, `data-width`, `data-height`, `data-start`, `data-duration`.
- Timeline registered as `window.__timelines["main"] = tl;` (object assignment, not `.push()`).
- Both CDN scripts present, gsap before the runtime.
- Timed elements use `class="clip"` plus `data-start` and `data-duration`.
- Inline scripts must not call `Math.random`, `Date.now`, `setTimeout`, `setInterval`, or use `repeat: -1`.
- Use `tl.fromTo()`, not `tl.from()` — the renderer seeks non-linearly and `from`'s `immediateRender:true` interacts badly with seeking.

There is **one V8-isolate quirk worth knowing**: the lint rule `invalid_inline_script_syntax` probes scripts via `new Function()`, which Cloudflare Workers refuse. The CF template filters that specific finding. We will need to do the same when we run lint inside any V8-isolate-style runtime (we won't, since our worker is Node — but worth noting).

### 1.3 Producer HTTP API (the worker we shamelessly copy)

From `research/hyperframes/packages/producer/src/server.ts`:

| Route | Method | Purpose |
| --- | --- | --- |
| `/render` | POST | blocking render, JSON response |
| `/render/stream` | POST | SSE streaming render with progress events |
| `/render/queue` | GET | current queue status |
| `/lint` | POST | run `@hyperframes/core` lint over a composition |
| `/health` | GET | health check |
| `/outputs/:token` | GET | download rendered MP4 with TTL'd token |

Body for `/render`:

```jsonc
{
  "projectDir": "/abs/path/to/composition",  // OR
  "previewUrl": "https://...",                // OR
  "html": "<!DOCTYPE html>...",               // pick one of the three
  "outputPath": null,
  "fps": 30,                                   // or "30000/1001" rational string
  "quality": "high",                           // "draft" | "standard" | "high"
  "format": "mp4",                             // "mp4" | "webm" | "mov"
  "workers": "auto",
  "gpu": false,
  "debug": false,
  "entryFile": "index.html"
}
```

Programmatic API (from `research/hyperframes/packages/producer/src/index.ts`):

```ts
import { createRenderJob, executeRenderJob, runHyperframeLint } from "@hyperframes/producer";
```

Plus distributed primitives `plan`, `assemble`, `renderChunk` for sharded rendering. We'll **embed the producer as a library** rather than fork its HTTP server — gives us a single Node process for both agent loop and render dispatch.

### 1.4 What HyperFrames is NOT

- Not Sora / Runway. It does not invent footage. It renders structured HTML/JS into video.
- Not a full timeline NLE. As of v0.6.6 the bundled Studio supports move/trim/track-change, but **not** split / slip / slide / ripple / roll. We accept the same constraint in V1.
- Not distributed cloud rendering out-of-the-box (Remotion Lambda still wins on scale). Single-machine renders are fine for our scope.

---

## 2. The Cloudflare template — our MVP loop

`research/hf-cf-template/src/lib/generate.ts` (~180 lines) is the cleanest "prompt → linted HyperFrames HTML" implementation we found. The shape we copy:

```ts
async function generateComposition({ apiKey, prompt, model, durationSec }) {
  // 1. Build a system prompt with composition rules + reference example.
  // 2. Call the LLM (OpenRouter → openai-compatible → Gemini 3 Flash by default).
  // 3. Strip markdown fences from the response.
  // 4. Lint via @hyperframes/core/lint, filter the V8-isolate false positive.
  // 5. If lint errors, re-prompt with the assistant's html + error list, up to 2 retries (lower temp).
  // 6. Return { html, model, attempts, lintErrors, durationMs }.
}
```

The system prompt (`research/hf-cf-template/src/lib/hyperframes-skill.ts`) is **the gold-standard structured prompt for HyperFrames**. It includes:

- Mandatory skeleton with named slots.
- The full composition rule set.
- Animation quality guidelines (three-phase pacing: build → breathe → resolve, choreographed exits).
- Visual design guidelines (palette, typography, layered z-index, multi-layer box-shadow).
- A reference example composition to imitate.
- A pre-submit checklist.

**We will lift this prompt directly into `packages/compose/src/prompts/composition.ts`** and adapt it per-preset (different palettes, different beat skeleton).

The render side of the CF template (`container/server.mjs`) is also tiny:

```js
// POST /render { files: [{path, content: base64}] } → 200 video/mp4
// 1. Decode files into mkdtemp(/tmp/render-...)
// 2. spawn(`hyperframes`, ['render', compDir, '-o', out, '--workers', 'auto'])
// 3. Stream the resulting MP4 back as response body.
```

**Our worker is the same idea, with one process per render.** The image baking pattern (apt deps + `npm i hyperframes ffmpeg-static` + `npx hyperframes browser ensure` at build time) is exactly how we ARM-ify it for Oracle.

---

## 3. The Vercel template — fallback render backend

`research/hf-vercel-template/lib/sandbox.ts` shows the `@vercel/sandbox` pattern:

- Sandbox: `runtime=node22`, `vcpus=4`, `timeout=10min`.
- First boot installs Chromium libs via `dnf install` plus `npm i hyperframes ffmpeg-static`.
- Snapshot the prepared sandbox to `@vercel/blob`; restore on subsequent renders.
- Stream composition files in, run `npx hyperframes render`, stream MP4 out.

We keep this in our codebase as `RENDER_BACKEND=vercel-sandbox` so anyone can fork-and-deploy without provisioning Oracle. Default backend is `oracle-worker`.

The preview-proxy code (`lib/preview.ts`) is also useful. It rewrites relative URLs in subcompositions and injects the runtime via `<script src="/api/runtime.js">` rather than the CDN — meaning the preview survives offline / firewalled envs. We adopt this for our editor preview.

---

## 4. VibeFrame — agent workflow patterns we steal

VibeFrame (`research/vibeframe/`) is a CLI/MCP layer on top of HyperFrames. It's not a UI; we ignore the CLI surface. What we want:

### 4.1 Three lanes mental model

From `vibeframe/FUNCTIONS.md`:

| Lane | Trigger | Source of truth |
| --- | --- | --- |
| BUILD | "make me a video about X" | `STORYBOARD.md` + `DESIGN.md` |
| GENERATE / ASSET | "make me one image of X" | the prompt |
| EDIT / REMIX | "edit this video" | the existing media |

We collapse this into our two top-level loops (BUILD + EDIT-SOURCE) plus a TWEAK loop for in-flight changes. Same idea, fewer surfaces.

### 4.2 STORYBOARD.md + DESIGN.md as plan format

VibeFrame's STORYBOARD.md uses fenced YAML cues per beat:

````markdown
## Beat hook — Open
```yaml
narration: "Start with a storyboard..."
backdrop: "Clean developer terminal beside structured cues"
video: "Slow push-in across panels"
voice: "alloy"
music: "minimal pulse, confident"
duration: 5
```
````

Cues that match local paths (`media/foo.png`) reuse files; text cues trigger generation. We adopt the same shape but as `plan.json` (Zod-validated) under `oci://bucket/projects/<id>/plan.json`. Markdown is for humans; JSON is for the agent.

### 4.3 Tool manifest pattern

VibeFrame's MCP server is **just** `manifestToMcpTools(manifest)` over the CLI's tool manifest. One source-of-truth file feeds:

- the CLI command graph
- the MCP server's `tools/list` and `tools/call`
- the agent's available functions
- the docs

We adopt this exactly. `packages/core/src/tools.ts` is the manifest; everything else (LLM tool list, internal RPC, future MCP, OpenAPI doc) is generated from it.

### 4.4 Reports as machine-readable artifacts

VibeFrame writes `build-report.json` after a build and `review-report.json` after inspection. Agents read those rather than parsing console logs. We do the same per-job: `oci://bucket/projects/<id>/jobs/<job-id>/report.json` is the canonical "what happened" artifact.

---

## 5. mcp-video — tool catalog shape

`research/mcp-video/mcp_video/server_tools_*.py` exposes ~80 MCP tools, grouped by file. Snapshot:

- `server_tools_basic.py` — probe, convert, merge, trim, resize, crop, rotate, fade, reverse, speed
- `server_tools_audio.py` — extract-audio, normalize-loudness, duck, waveform, mute-segment
- `server_tools_effects.py` — overlay, mask, chroma-key, watermark, text, transitions, glitch
- `server_tools_hyperframes.py` — init, build, render, scene-add, template-list, captions, motion-overlay
- `server_tools_creation.py` — high-level create-from-prompt
- `server_tools_repurpose.py` — long → shorts pipeline
- `server_tools_ai.py` — wrappers around external AI providers
- `server_tools_advanced.py` — HLS, batch, storyboard

We don't ship MCP in V1 (that's V2), but we **organise our internal tool functions the same way**. `apps/worker/src/tools/{basic,audio,effects,hyperframes,...}.ts`. Same names, typed signatures, returning JSON.

---

## 6. video-use — long-video pattern

`research/video-use/README.md` documents a clever thing: don't dump frames to the LLM. Instead:

1. **Layer 1 — transcript (always loaded).** One Scribe call per source produces word-level timestamps + speakers + audio events. All takes pack into `takes_packed.md`, ~12 KB total.
2. **Layer 2 — visual composite (on demand).** A `timeline_view` tool produces a filmstrip + waveform + word-labels PNG for any time range — only called at decision points.

For a 30-minute interview, a naive "send frames" approach is ~45M tokens. video-use does it in ~12 KB of text plus a handful of PNGs.

We adopt this exactly, with one substitution: **Gemini 3.1 Pro ingests audio natively**, so we don't need ElevenLabs Scribe. We send the wav directly to Gemini and ask for a structured JSON transcript.

Their pipeline:

```
Transcribe → Pack → LLM Reasons → EDL → Render → Self-Eval
                                                   │
                                                   └─ issue? fix + re-render (max 3)
```

We add one variant: between "EDL" and "Render", we run our HyperFrames composition build (since we don't render with raw ffmpeg-only — we wrap the source video inside a composition that adds captions / overlays / B-roll).

---

## 7. Vertex AI — what's actually available (May 2026)

| Feature | Model ID | Source |
| --- | --- | --- |
| Best reasoning | `gemini-3.1-pro` | [Vertex AI model card](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/models/gemini/3-1-pro), released Feb 19, 2026 |
| Multimodal input | text / audio / images / video / PDFs / code repos in 1M-token context | [Gemini 3.1 Pro Preview](https://ai.google.dev/gemini-api/docs/models/gemini-3.1-pro-preview) |
| Cheap fast tier | `gemini-2.5-flash` | for intent classification, cost-sensitive calls |
| Image generation (premium) | `gemini-3-pro-image` (Nano Banana Pro) — up to 4K, strong text | [Vertex Gemini 3 Pro Image](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/models/gemini/3-pro-image) |
| Image generation (cheap) | `imagen-4.0-fast-generate-001` | [Imagen overview](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/image/overview) |
| Audio understanding | Gemini 3.1 Pro audio parts | [Audio understanding (speech only)](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/multimodal/audio-understanding) |
| Video understanding | Gemini 3.1 Pro video parts | [Video understanding](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/multimodal/video-understanding) |
| Multimodal embeddings | for asset cache + B-roll search | [Embeddings API](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/model-reference/multimodal-embeddings-api) |
| Live API (voice/video) | low-latency two-way; useful for interactive narration capture | [Multimodal Live API](https://cloud.google.com/vertex-ai/generative-ai/docs/multimodal-live-api) |

**Gotcha:** `gemini-3-pro-preview` (the older one, not 3.1) was discontinued March 26, 2026 — references in older blog posts may use that ID. Use `gemini-3.1-pro` everywhere.

Content was rephrased for compliance with licensing restrictions.

---

## 8. Stock APIs

### Pixabay

- Free tier with API key. Default 100 requests/min ([Pixabay docs](http://pixabay.com/api/docs/)).
- Both images and videos (HD/4K) under one search.
- License: free for commercial use, no attribution required.
- We use this **first** for both stock images and stock video B-roll.

### Unsplash

- Free demo tier 50 requests/hour ([rate-limit help](https://help.unsplash.com/en/articles/3887917-when-should-i-apply-for-a-higher-rate-limit)).
- Production tier on application.
- **Attribution required** ([guidelines](https://help.unsplash.com/api-guidelines/unsplash-api-guidelines)) — photographer name + link to Unsplash profile + link to Unsplash.
- Images only. We use it as a **fallback** when Pixabay returns no good match.

### Freepik

- Pay-as-you-go credits, 5 EUR free trial ([pricing docs](https://www.freepik.com/ai/docs/pricing-and-billing)).
- Provides stock + AI generation + Magnific upscalers, image and video.
- BYOK in our app — Freepik is a power-user escape hatch, not on by default.

---

## 9. Oracle Cloud Free Tier — facts that matter

From the [Always Free quota docs](https://docs.cloud.oracle.com/Content/FreeTier/freetier.htm):

- **Ampere A1 ARM compute**, capped at 4 OCPUs + 24 GB memory total across all instances in the tenancy.
- 200 GB block storage total.
- 10 TB egress/month.
- Always Free — no expiry, distinct from the 30-day $300 trial.
- We can split as 1×(4 OCPU/24 GB) for a single fat worker, or 2×(2 OCPU/12 GB) for redundancy. We ship single-instance for V1.

**ARM gotchas to budget for:**

- `ffmpeg-static` doesn't ship ARM64 binaries on all platforms. Use the apt package (`apt install -y ffmpeg`) — it's 7.x on Debian 12.
- Puppeteer's `chrome-headless-shell` does ship ARM64. `npx hyperframes browser ensure` will fetch the right one.
- Most npm-built-from-source modules (sharp, etc.) build fine on ARM64 with build-essentials.

Cost note: Oracle is "free" but data egress over 10 TB/month does cost. We won't hit it for V1 (our renders go to OCI Object Storage in the same region; only the final download to user's browser counts as egress, and 10 TB = ~50,000 1080p reels at 200 MB each).

---

## 10. Key code snippets we'll re-use

### 10.1 The lint-and-self-heal loop (adapted from CF template)

```ts
// packages/compose/src/lintHeal.ts (sketch)
import { lintHyperframeHtml } from "@hyperframes/core/lint";
import { generateText } from "../providers/vertex";

export async function generateAndHeal(
  systemPrompt: string,
  userPrompt: string,
  opts: { maxRetries?: number } = {},
) {
  const max = opts.maxRetries ?? 2;
  let messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ];

  let html = stripFence(await generateText({ model: "gemini-3.1-pro", messages, temperature: 0.7 }));
  let errors = lintFiltered(html);

  for (let i = 0; i < max && errors.length > 0; i++) {
    messages = [
      ...messages,
      { role: "assistant", content: html },
      { role: "user", content: `Fix these errors and return the corrected HTML only:\n${formatErrors(errors)}` },
    ];
    html = stripFence(await generateText({ model: "gemini-3.1-pro", messages, temperature: 0.3 }));
    errors = lintFiltered(html);
  }

  return { html, attempts: 1 + (errors.length ? max : 0), lintErrors: errors };
}
```

### 10.2 The render dispatch (Producer-as-library)

```ts
// apps/worker/src/render/runRender.ts (sketch)
import { createRenderJob, executeRenderJob } from "@hyperframes/producer";
import { writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export async function runRender({ html, projectId, fps = 30, quality = "high" }) {
  const dir = await mkdtemp(join(tmpdir(), `hf-${projectId}-`));
  try {
    await writeFile(join(dir, "index.html"), html, "utf8");
    const job = await createRenderJob({
      projectDir: dir,
      outputPath: join(dir, "out.mp4"),
      fps: { num: fps, den: 1 },
      quality,
      format: "mp4",
      workers: "auto",
      useGpu: false,
      debug: false,
    });
    const result = await executeRenderJob(job, {
      onProgress: (p) => publish(`jobs:${projectId}:events`, { type: "progress", ...p }),
    });
    return result;  // { outputPath, perfSummary }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
```

### 10.3 Long-video pattern

```ts
// apps/worker/src/agents/editSource.ts (sketch of step 3-5)
const audioPath = await ffmpegExtractAudio(srcVideoPath);
const transcript = await vertex.audioUnderstanding({
  model: "gemini-3.1-pro",
  audioPath,
  schema: TranscriptSchema,   // zod schema for word-level timestamps + speakers
});
const packed = packTranscript(transcript);   // ~12KB markdown
const edl = await vertex.generateText({
  model: "gemini-3.1-pro",
  messages: [
    { role: "system", content: EDIT_SYSTEM_PROMPT },
    { role: "user", content: `${userPrompt}\n\n${packed}` },
  ],
  schema: EDLSchema,
});
```

---

## 11. What we explicitly do NOT use (and why)

- **HyperFrames Studio embedded.** Tightly coupled to its own dev loop, React 19 + Vite, and edits the local filesystem. We build our own editor that targets OCI-stored compositions instead.
- **VibeFrame CLI as a dependency.** Adds Node/pnpm baggage we don't need. Their patterns yes; their code no.
- **mcp-video as a runtime dependency.** Python + heavy. We re-implement a small set of its tools in TypeScript.
- **video-use as a runtime dependency.** Same reason. We borrow the pattern.
- **ElevenLabs Scribe.** Gemini 3.1 Pro does multilingual audio understanding directly.
- **Remotion.** Two video frameworks is one too many. HyperFrames is the bet.
- **Cloudflare Containers as the prod renderer.** The template is great; the platform is paid (Workers Paid plan required for Containers, ~$5/month minimum, plus pay-per-10ms). Oracle Free Tier is free.

---

## 12. Reading list (for the team)

1. [HyperFrames Introduction](https://hyperframes.heygen.com/introduction) — the conceptual frame.
2. [Compositions](https://hyperframes.mintlify.app/concepts/compositions) — exact data-attribute reference.
3. [Frame Adapters](https://hyperframes.mintlify.app/concepts/frame-adapters) — why we don't use wall-clock animations.
4. [GSAP Animation guide](https://hyperframes.mintlify.app/guides/gsap-animation) — the load-bearing rules.
5. [Common Mistakes](https://hyperframes.heygen.com/guides/common-mistakes) — read once, save hours.
6. [Cloudflare template README](https://github.com/heygen-com/hyperframes-cloudflare-template) — the architecture diagram is a single screen and explains the whole MVP.
7. [Gemini 3.1 Pro on Vertex AI](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/models/gemini/3-1-pro) — the model card.
8. [VibeFrame README](https://github.com/vericontext/vibeframe) — read sections on lanes and STORYBOARD/DESIGN.
9. [video-use README](https://github.com/browser-use/video-use) — read the "How it works" two paragraphs; everything follows.

Content was rephrased for compliance with licensing restrictions.
