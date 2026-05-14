# hyperframe-editor — Master Plan

> **Goal.** A web-based AI video-editor agent. You give it a prompt or a video (or both) and a preset, and it analyses the source, plans a timeline, fetches/generates assets, builds a HyperFrames composition, renders an MP4, and lets you chat or hand-edit to revise. Frontend on Vercel; rendering and agent orchestration on Oracle Cloud Free Tier.

This document is the **single source of truth** for what we are building, in what order, with what shape. It folds together the architecture, the agent state machine, the preset library, the editor UI spec, the API surface, the env vars, and the phased roadmap. Read [NOTES.md](./NOTES.md) for the underlying research.

---

## 0. North-star principles

1. **HyperFrames HTML is the source of truth.** Every project on disk and in storage is a directory of HTML/CSS/JS plus a small `project.json`. Agents and humans both edit those files. There is no proprietary timeline binary. This is the single most important architectural decision — it makes the agent loop, the manual editor, the renderer, and the version-control story all line up.
2. **Two loops, not one.**
   - **Compose loop**: prompt → plan → assets → composition HTML → preview → revise → render. (VibeFrame / Cloudflare-template style.)
   - **Edit-source loop**: existing video in → transcript + analysis → edit decision list (EDL) → re-encode + overlays → render. (video-use style.)
   The agent picks the right loop from the user's intent; the user can override.
3. **Don't watch every frame.** For long inputs we follow video-use's "text + on-demand visuals" rule: transcribe once with Gemini, pack a markdown view, only fetch frame thumbnails at decision points.
4. **Determinism over magic.** No `Date.now()`, no `Math.random()` without a seeded RNG, no network fetches at render time. Same input → identical MP4.
5. **Cheap before clever.** Each render call has a budget gate; each provider call has a soft cap; the agent reports a cost ledger before spending money.
6. **Preset > blank slate.** First-class presets for the formats we care about (TikTok hook, YouTube essay, devotional reel, product promo, educational explainer, podcast clip…). The blank-slate "make me something" prompt is supported but discouraged.
7. **Always-resumable.** Job state lives in Postgres. Workers crash → another picks up. The frontend reconnects to in-progress jobs by ID.

---

## 1. System architecture

```
┌─────────────────────── Browser (Vercel-served Next.js app) ────────────────────────┐
│                                                                                    │
│   Chat panel ─┐         Timeline ─┐         Preview (<hyperframes-player>) ─┐       │
│               └─► editor store (Zustand) ──┴─► composition.html (live)     │       │
│   Asset library      Job inspector                                          │       │
│                                                                              │       │
└─────────────┬─────────────────────────────────────────┬──────────────────────┴──────┘
              │  HTTPS                                 │  EventSource (SSE)
              ▼                                         ▼
┌──────────────────── API edge (Next.js Route Handlers on Vercel) ─────────────────────┐
│  /api/projects               Project CRUD, presets, manifest                          │
│  /api/agent/turn             SSE stream of agent steps + tool calls                   │
│  /api/agent/upload-url       Signed URL for direct-to-OCI upload                      │
│  /api/render                 Enqueue render → returns jobId + SSE URL                 │
│  /api/render/:id/stream      SSE: progress %, log lines, final URL                    │
│  /api/stock/{pixabay,unsplash,freepik}/search                                         │
│  /api/preview/runtime.js     Serves @hyperframes/core runtime IIFE                    │
└──────────────┬───────────────────────────────────────────────────────────────┬────────┘
               │ Postgres (jobs, projects, cost ledger)                        │
               │ Redis (queue, pubsub)                                         │
               ▼                                                                ▼
┌────── Oracle Cloud Free Tier (ARM Ampere A1, 4 OCPU / 24 GB / 200 GB) ─────────────────┐
│                                                                                        │
│   ┌────── orchestrator (Node) ─────┐  ┌────── render workers (1–N) ───────┐           │
│   │ • pulls jobs from queue        │  │ • Docker image: node22 + Chromium  │           │
│   │ • runs agent state machine     │  │   + ffmpeg + hyperframes           │           │
│   │ • Vertex AI calls              │  │ • POST /render with files          │           │
│   │ • stock-API calls              │  │ • streams MP4 to OCI Object Store  │           │
│   │ • writes project files to OCI  │  │ • emits SSE progress to Redis      │           │
│   │ • writes Postgres job rows     │  └────────────────────────────────────┘           │
│   └────────┬───────────────────────┘                                                   │
│            │ pubsub (Redis) — "agent step", "render progress" → SSE bridge             │
└────────────┴───────────────────────────────────────────────────────────────────────────┘
                                       │
                                       ▼
                         OCI Object Storage (S3-compatible)
                         ─ projects/<id>/composition.html
                         ─ projects/<id>/assets/*
                         ─ renders/<id>/<timestamp>.mp4
```

### Why this split

- **Vercel** handles auth, project CRUD, the editor UI, and short-lived API calls. It does **not** render — Vercel function timeouts and CPU limits kill HyperFrames jobs, and we don't want to pay for Sandbox seconds.
- **Oracle Free Tier** handles agent reasoning loops (which take minutes) and rendering (which takes minutes too). 4 ARM cores + 24 GB RAM is enough for ~2 parallel renders at 1080p with `--workers auto`.
- **Postgres + Redis** are the seam between them. Vercel writes a job row, Redis publishes "new job", Oracle picks it up, Oracle publishes progress, Vercel forwards it to the browser as SSE.

### Why not just Vercel?

The Vercel template (`hf-vercel-template`) uses `@vercel/sandbox` to render — it works, but:

1. Sandbox time is metered; renders are minute-scale; this gets expensive fast.
2. Long agent loops (analysing a 10-minute video) overshoot any reasonable function timeout.
3. We already have free 24 GB ARM machines from Oracle. Use them.

We **do** keep the Vercel sandbox option in code as a fallback render backend (env-flag `RENDER_BACKEND=vercel-sandbox`) so the project remains deployable to Vercel-only for demos.

---

## 2. Repository layout

We'll structure this as a **pnpm workspace monorepo** because the Vercel app and the Oracle worker share a lot of types (composition schema, preset definitions, agent prompts, tool catalog).

```
hyperframe-editor/
├── apps/
│   ├── web/                      # Next.js 15 (App Router) — deploys to Vercel
│   │   ├── app/
│   │   │   ├── (editor)/[id]/    # The editor view: chat + timeline + preview
│   │   │   ├── (dashboard)/      # Project list, billing, settings
│   │   │   ├── api/
│   │   │   │   ├── projects/
│   │   │   │   ├── agent/turn/
│   │   │   │   ├── render/
│   │   │   │   ├── render/[id]/stream/
│   │   │   │   └── stock/
│   │   │   └── layout.tsx
│   │   ├── components/
│   │   │   ├── editor/Chat.tsx
│   │   │   ├── editor/Timeline.tsx
│   │   │   ├── editor/Preview.tsx       # wraps <hyperframes-player>
│   │   │   ├── editor/AssetDrawer.tsx
│   │   │   └── editor/RenderQueue.tsx
│   │   ├── lib/
│   │   │   ├── store.ts                 # Zustand: composition + chat + jobs
│   │   │   ├── sse.ts                   # SSE client helpers
│   │   │   └── auth.ts
│   │   └── package.json
│   │
│   └── worker/                   # Long-running Node process — runs on Oracle
│       ├── src/
│       │   ├── orchestrator/             # state machine, queue consumer
│       │   ├── agents/                   # Gemini-driven reasoning loops
│       │   ├── tools/                    # ffmpeg, hyperframes, stock, vertex
│       │   ├── render/                   # spawns hyperframes render
│       │   ├── storage/                  # OCI Object Storage adapter
│       │   └── index.ts
│       ├── Dockerfile                    # ARM64 image, baked deps
│       └── package.json
│
├── packages/
│   ├── core/                     # Shared types, schemas, preset registry
│   │   ├── src/
│   │   │   ├── composition.ts            # zod schemas
│   │   │   ├── preset.ts                 # Preset interface + registry
│   │   │   ├── plan.ts                   # Storyboard / EDL schemas
│   │   │   ├── tools.ts                  # Tool manifest (LLM-callable)
│   │   │   └── index.ts
│   │   └── package.json
│   │
│   ├── compose/                  # HyperFrames composition writers
│   │   ├── src/
│   │   │   ├── builder.ts                # compose() — build HTML from plan
│   │   │   ├── blocks/                   # Reusable scenes (intro, lower-third, caption-block, …)
│   │   │   ├── transitions/              # GSAP-driven, deterministic
│   │   │   ├── presets/                  # tiktok-hook.ts, devotional-reel.ts, …
│   │   │   └── lint.ts                   # wraps @hyperframes/core lint
│   │   └── package.json
│   │
│   ├── providers/                # External API adapters
│   │   ├── src/
│   │   │   ├── vertex/                   # Gemini 3.1 Pro, Nano Banana Pro, Imagen
│   │   │   ├── pixabay/
│   │   │   ├── unsplash/
│   │   │   ├── freepik/
│   │   │   └── index.ts
│   │   └── package.json
│   │
│   ├── ffmpeg/                   # Type-safe wrappers around ffmpeg
│   │   └── src/
│   │       ├── probe.ts
│   │       ├── extractAudio.ts
│   │       ├── thumbnail.ts
│   │       ├── timelineView.ts           # filmstrip + waveform PNG (video-use style)
│   │       ├── silenceCut.ts
│   │       ├── caption.ts                # burn-in or sidecar SRT
│   │       └── normalize.ts
│   │   └── package.json
│   │
│   └── eslint-config/            # shared lint
│
├── infra/
│   ├── oracle/
│   │   ├── terraform/                    # VCN, A1 instance, security lists
│   │   ├── docker-compose.yml            # postgres, redis, worker, n8n optional
│   │   └── systemd/                      # worker.service, watchdog
│   └── github-actions/
│       └── deploy-worker.yml             # build ARM64 image, push to OCI registry
│
├── PLAN.md                       # ← this file
├── NOTES.md                      # research distillation
├── README.md
├── pnpm-workspace.yaml
├── package.json
├── turbo.json
└── tsconfig.base.json
```

---

## 3. Data model (Postgres)

```sql
-- Projects: one composition the user is working on.
create table projects (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references users(id),
  title         text not null,
  preset        text not null,        -- 'tiktok-hook' | 'youtube-essay' | …
  width         int  not null,
  height        int  not null,
  fps           int  not null default 30,
  duration_sec  numeric not null default 0,
  storage_uri   text not null,        -- oci://bucket/projects/<id>
  status        text not null default 'draft',
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

-- Sources: every uploaded raw video / audio / image / pdf the agent can use.
create table sources (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references projects(id) on delete cascade,
  kind         text not null,        -- 'video' | 'audio' | 'image' | 'doc'
  storage_uri  text not null,
  duration_sec numeric,
  width        int,
  height       int,
  transcript   jsonb,                -- {segments: [{start,end,text,speaker}], lang, ...}
  analysis     jsonb,                -- Gemini's scene-level notes
  created_at   timestamptz default now()
);

-- Jobs: every long-running unit of work (analyse, plan, build, render).
create table jobs (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references projects(id) on delete cascade,
  kind         text not null,        -- 'analyze' | 'plan' | 'build' | 'render' | 'agent_turn'
  status       text not null,        -- 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'
  worker_id    text,
  input        jsonb,
  output       jsonb,
  error        text,
  cost_usd     numeric default 0,
  started_at   timestamptz,
  finished_at  timestamptz,
  created_at   timestamptz default now()
);

-- Agent turns: chat messages + tool-call traces.
create table agent_messages (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references projects(id) on delete cascade,
  role         text not null,        -- 'user' | 'assistant' | 'tool'
  content      jsonb not null,       -- {text, tool_call, tool_result, …}
  tokens_in    int,
  tokens_out   int,
  cost_usd     numeric default 0,
  created_at   timestamptz default now()
);

-- Cost ledger (per-user spend caps).
create table cost_events (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null,
  project_id   uuid,
  job_id       uuid,
  provider     text not null,        -- 'vertex-gemini-3-1-pro' | 'pixabay' | …
  unit         text not null,        -- 'tokens-in' | 'tokens-out' | 'image' | 'render-second'
  qty          numeric not null,
  cost_usd     numeric not null,
  created_at   timestamptz default now()
);
```

The composition itself lives in **storage** (`oci://bucket/projects/<id>/composition.html` plus `assets/*`), not Postgres. Postgres only holds metadata. This keeps the DB tiny and makes the same files work for the renderer (which mounts them into the worker's tmpdir) and for the editor (which fetches them via signed URLs).

---

## 4. Agent state machine

The orchestrator runs one of three top-level workflows depending on intent. They share lower-level steps (analyse, fetch-stock, image-gen, compose-scene, lint, render).

```
                    ┌─────────────────────┐
                    │ user prompt + files │
                    └──────────┬──────────┘
                               │
                    ┌──────────▼──────────┐
                    │  classify intent    │ ← Gemini 3.1 Pro (cheap call)
                    └──────────┬──────────┘
                               │
            ┌──────────────────┼──────────────────┐
            ▼                  ▼                  ▼
     [BUILD]              [EDIT-SOURCE]       [TWEAK]
   prompt-only         video(s) supplied   in-flight project
            │                  │                  │
            ▼                  ▼                  ▼
     compose loop       edit-source loop    apply-patch loop
```

### 4.1 BUILD (compose) loop — "make me a 30s reel about X"

```
START
  └─► load preset (e.g. tiktok-hook) → palette, dims, beat skeleton
  └─► WRITE_BRIEF        ── Gemini distils prompt → STORYBOARD.md
  └─► WRITE_DESIGN       ── Gemini → DESIGN.md (palette, type, motion, transitions)
  └─► PLAN_BEATS         ── Gemini → list of beats: {id, narration, dur, asset_cues}
  └─► ACQUIRE_ASSETS     ── per-beat:
        ├─ stock search (Pixabay → Unsplash → Freepik in priority order)
        ├─ if no good match, image-gen (Nano Banana Pro / Imagen 4)
        └─ TTS narration (Gemini Live API or Vertex TTS)
  └─► COMPOSE            ── packages/compose/builder.ts → composition.html
  └─► LINT               ── @hyperframes/core lint, self-heal up to 2x
  └─► PREVIEW            ── push to player, surface to user
  └─► (user revises in chat or timeline)
  └─► RENDER             ── final MP4
```

### 4.2 EDIT-SOURCE loop — "edit this 8-min video into a 60s highlight"

```
START
  └─► PROBE              ── ffprobe → duration, codec, fps, audio tracks
  └─► EXTRACT_AUDIO      ── 16kHz mono wav for analysis
  └─► TRANSCRIBE         ── Gemini 3.1 Pro audio understanding → segments + speakers
  └─► PACK_SOURCES       ── video-use style takes_packed.md (~12KB)
  └─► ANALYSE_SCENES     ── Gemini reads packed view, marks key moments + dead spots
  └─► PROPOSE_EDL        ── Gemini → edit decision list:
        [ {src_id, in, out, layer, crop?, speed?}, ... ]
  └─► (optional) FETCH_BROLL    ── stock + image-gen for visualised concepts at timecodes
  └─► COMPOSE_OVER_EDL   ── builder builds HyperFrames composition that uses the edit:
        - root <video src="trimmed.mp4">
        - overlays: captions, b-rolls, motion graphics at timecodes
        - lower-thirds at speaker changes
  └─► LINT → PREVIEW → RENDER (same tail as BUILD)
```

### 4.3 TWEAK loop — "make the title bigger and add a CTA at the end"

Lightweight. The agent receives the current `composition.html` + chat instruction, returns a **patch** (JSON-Patch over the parsed composition AST, not raw text), the patch is applied, lint runs, preview updates. No new render until the user asks.

### 4.4 Tool catalog (what Gemini can actually call)

We expose tools as plain JSON-Schema function declarations (Vertex AI tool-use format). Categories mirror mcp-video, but trimmed to what the editor actually needs:

| Category | Tools |
| --- | --- |
| **Source analysis** | `probe_media`, `extract_audio`, `transcribe`, `summarize_segment`, `detect_scenes`, `silence_segments` |
| **Composition** | `set_composition_meta`, `add_scene`, `add_clip`, `move_clip`, `trim_clip`, `set_track_order`, `apply_transition`, `add_caption_block`, `add_lower_third`, `add_logo_bug` |
| **Stock & gen** | `search_pixabay`, `search_unsplash`, `search_freepik`, `download_asset`, `gen_image`, `gen_image_variation`, `gen_voiceover` |
| **Editing** | `silence_cut`, `auto_caption`, `color_grade_preset`, `normalize_loudness`, `duck_music_under_voice`, `ken_burns`, `reframe_to_aspect` |
| **Validation** | `lint_composition`, `dry_render` (1-frame test), `cost_estimate` |
| **Final** | `render`, `cancel_render` |

Every tool is implemented as a typed function in `apps/worker/src/tools/`, registered in a single manifest (mirroring VibeFrame's `manifestToMcpTools` trick). The same manifest can later be exposed as an MCP server for Claude Code / Cursor / Codex users.

### 4.5 Step output, retries, and the cost gate

Each step writes a `jobs` row with input + output. Retries are bounded:

| Step | Max retries | Self-heal strategy |
| --- | --- | --- |
| compose | 2 | re-prompt with lint errors (Cloudflare-template pattern) |
| transcribe | 1 | fall back to Gemini 2.5 Flash if 3.1 Pro errors |
| stock | 0 | fall back to next provider in priority list |
| image-gen | 1 | re-prompt with "more specific" hint |
| render | 1 | retry on a fresh worker pod |

Before any render or paid-API call, the orchestrator computes an **estimated cost** and checks the user's project budget (`projects.budget_usd`). If over budget, the run pauses and surfaces a confirmation prompt to the chat panel.

---

## 5. Composition library (the "compose" package)

This is where the magic of "AI knows how to make good video" lives. The agent does **not** synthesise raw HTML/CSS each call. It picks **blocks** (named scene templates) and **fills variables**. The blocks are hand-authored once and tested.

### 5.1 Blocks (scene templates)

Each block is a TypeScript function that takes typed props and returns a HyperFrames-valid HTML fragment. They compose into a final `composition.html`.

```ts
// packages/compose/src/blocks/HookTitle.ts
export interface HookTitleProps {
  start: number;          // seconds
  duration: number;
  text: string;
  subtext?: string;
  palette: Palette;
  font: FontPair;
  bgVideo?: string;       // optional B-roll
}
export function HookTitle(p: HookTitleProps): HFFragment { ... }
```

Initial block library (≥ 25 by V1):

- `HookTitle`, `KineticHeadline`, `LowerThird`, `LogoBug`, `EndCard`
- `CaptionBlock` (TikTok-style 2-word UPPERCASE, configurable)
- `BRollWindow` (picture-in-picture B-roll over speaker)
- `KenBurnsImage`, `SplitScreen`, `TextBehindSubject` (uses HyperFrames remove-background)
- `WaveformVisualizer`, `BarChart`, `TimelineGraph`
- `QuoteCard`, `ScriptureCard` (devotional preset)
- `ProductHero`, `FeatureBullets`, `PriceTag`
- `TransitionFlash`, `TransitionWipe`, `TransitionGlitch`

We seed many of these by adapting the **HyperFrames catalog** (`npx hyperframes add ...`) and the registry blocks under `research/hyperframes/registry/blocks/`.

### 5.2 Presets

A preset is a typed configuration that bundles:

- canvas dims (width, height, fps)
- palette + font defaults
- a "beat skeleton" the planner expands into
- recommended block choices per beat
- guardrails (max duration, banned blocks, required CTA, etc.)

```ts
// packages/compose/src/presets/tiktok-hook.ts
export const tiktokHook: Preset = {
  id: "tiktok-hook",
  label: "TikTok-style hook reel (9:16, 30s)",
  width: 1080, height: 1920, fps: 30,
  defaults: {
    palette: PALETTES.neonNight,
    font: FONTS.archivoBlackInter,
  },
  skeleton: [
    { id: "hook", durRange: [2, 4], blocks: ["HookTitle"] },
    { id: "promise", durRange: [3, 5], blocks: ["KineticHeadline", "BRollWindow"] },
    { id: "body", durRange: [15, 22], blocks: ["CaptionBlock", "KenBurnsImage", "SplitScreen"] },
    { id: "cta", durRange: [3, 5], blocks: ["EndCard"] },
  ],
  guardrails: { maxDuration: 60, requireCaptions: true, requireCta: true },
};
```

Initial presets (V1):

| Preset | Canvas | Length | Voice |
| --- | --- | --- | --- |
| `tiktok-hook` | 1080×1920 | 15–60s | TTS or muted |
| `youtube-short` | 1080×1920 | 30–60s | TTS or muted |
| `youtube-essay` | 1920×1080 | 3–10 min | source audio |
| `devotional-reel` | 1080×1920 | 30–60s | scripture quote + ambient |
| `product-promo` | 1920×1080 | 20–45s | TTS narration |
| `educational-explainer` | 1920×1080 | 60–180s | TTS + diagram blocks |
| `podcast-clip` | 1080×1920 or 1920×1080 | 30–90s | source audio + captions |
| `webinar-recap` | 1920×1080 | 60–180s | TTS over screenshots |
| `data-story` | 1920×1080 | 30–90s | TTS + chart blocks |
| `blank` | configurable | configurable | — |

### 5.3 Determinism rules baked into the builder

The builder enforces:

- every clip gets `class="clip"` and explicit `data-start`/`data-duration`
- GSAP timelines are paused, registered on `window.__timelines["main"]`
- a `tl.set(rootEl, {}, finalDuration)` exists so the timeline duration matches the composition's `data-duration`
- no `Math.random` or `Date.now` in inline scripts (lint rule)
- assets are referenced relative; the renderer mounts them at the same depth

---

## 6. Editor UI (apps/web)

A three-pane layout, no IDE-isms.

```
┌─────────────────────────────────────────────────────────────────┐
│  [project title]    [preset chip]    [Render ▾]  [Share]  [☰]    │  ← top bar
├──────────────┬───────────────────────────────────────────────────┤
│              │                                                   │
│   Chat       │              Preview                              │
│              │       (<hyperframes-player srcdoc=… />)           │
│  [agent      │                                                   │
│   stream]    │                                                   │
│              │                                                   │
│  ─────────   ├───────────────────────────────────────────────────┤
│  Asset       │              Timeline                              │
│  drawer      │   ┌──────────────────────────────────────────┐    │
│              │   │ track 0 ████████   ██████████   ████      │    │
│              │   │ track 1   ░░░░    ░░░       ░░░░░░░       │    │
│              │   │ track 2 ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓     │    │
│              │   │ track 3 ▒                                  │    │
│              │   └──────────────────────────────────────────┘    │
└──────────────┴───────────────────────────────────────────────────┘
```

### 6.1 State

A single Zustand store holds:

```ts
{
  project: Project,
  composition: Composition,            // parsed AST of composition.html
  sources: Source[],
  chat: AgentMessage[],
  jobs: Job[],
  selection: { clipId?: string, beatId?: string },
  preview: { time: number, playing: boolean },
}
```

The composition is **always parsed** to an AST in memory (using `@hyperframes/core` parsers). UI edits mutate the AST. On every commit we serialise back to HTML and push it both to the player (via `player.setAttribute("srcdoc", html)`) and to the API (debounced 500 ms) which writes it to OCI.

### 6.2 Chat panel

- Uses Vercel AI SDK's `useChat` (or our own SSE client over `/api/agent/turn`).
- Renders streaming agent messages with embedded **tool call traces** (collapsible JSON).
- Slash commands as shortcuts: `/build`, `/edit`, `/caption`, `/cut-silence`, `/render`, `/cost`, `/preset <name>`.
- "Apply suggested patch" buttons when the agent proposes a JSON-Patch — never auto-applies destructive changes.

### 6.3 Timeline

- HTML5 canvas-rendered for performance with hundreds of clips.
- Tracks (rows) match `data-track-index` of the composition.
- Drag horizontally → updates `data-start`. Drag between tracks → updates `data-track-index`. Resize edge → updates `data-duration`. All operations write the AST then re-serialise.
- Right-click clip → context menu: "Edit in chat ('make this red')", "Replace asset", "Delete", "Open block source".
- Zoom (Cmd+wheel) and a playhead that two-way binds with the player's `currentTime`.
- We do **not** try to ship full Premiere features in V1. No slip/slide/ripple/roll initially — same stance HyperFrames Studio takes today.

### 6.4 Preview

- Uses `@hyperframes/player` web component (`<hyperframes-player>`) with `srcdoc` attribute.
- The player handles seek-by-frame and timeline scrubbing.
- A small overlay shows current frame number, fps, and lint status badge.

### 6.5 Asset drawer

- Lists `sources` for the project.
- Search bar across stock providers (Pixabay → Unsplash → Freepik). Drag-to-timeline drops the asset into a new clip on a free track.
- "Generated" tab shows AI-image-gen history per project (with prompt + cost recorded).

### 6.6 Render queue

- Floating panel showing all jobs for this project (`agent_turn`, `analyze`, `plan`, `build`, `render`).
- Each job has a status bar fed by SSE (`/api/render/:id/stream`).
- Click a finished render → opens a modal with download, copy-link, "publish to YouTube" stub.

---

## 7. API surface (Vercel-hosted)

Every endpoint authenticates via Clerk or a JWT we sign ourselves (decision deferred to V1; for MVP we'll use a single magic-link auth via Resend).

| Route | Method | Purpose |
| --- | --- | --- |
| `/api/projects` | GET / POST | list / create project |
| `/api/projects/:id` | GET / PATCH / DELETE | manage project |
| `/api/projects/:id/composition` | GET / PUT | fetch / save composition.html |
| `/api/projects/:id/sources` | POST | register an uploaded source |
| `/api/projects/:id/upload-url` | POST | mint a signed PUT URL to OCI Object Storage |
| `/api/agent/turn` | POST (SSE) | one chat turn → streamed events |
| `/api/render` | POST | enqueue render → `{ jobId }` |
| `/api/render/:id/stream` | GET (SSE) | progress, log lines, final URL |
| `/api/jobs/:id` | GET | poll job state |
| `/api/jobs/:id/cancel` | POST | cancel running job |
| `/api/stock/pixabay` | GET | search stock |
| `/api/stock/unsplash` | GET | search stock |
| `/api/stock/freepik` | GET | search stock |
| `/api/preview/runtime.js` | GET | serves @hyperframes/core IIFE runtime |

**SSE format** (consistent across `/api/agent/turn` and `/api/render/:id/stream`):

```
event: step
data: {"step":"WRITE_BRIEF","status":"running"}

event: log
data: {"level":"info","msg":"plan: 5 beats, 32.0s total"}

event: tool
data: {"name":"search_pixabay","input":{"q":"sunrise temple"},"output":{"hits":12}}

event: progress
data: {"pct":48,"frame":580,"total":1200}

event: done
data: {"url":"https://objectstorage.../renders/.../final.mp4"}
```

---

## 8. Worker (apps/worker)

The Oracle worker is a single Node 22 process that:

1. Connects to Postgres + Redis.
2. Subscribes to the Redis Stream `jobs:queue`.
3. For each job, runs the matching state machine (compose / edit-source / tweak / render / agent_turn).
4. Publishes step/progress/log events to Redis Pub/Sub channel `jobs:<id>:events`.
5. On done, writes the artifact to OCI Object Storage and updates the `jobs` row.

Render concurrency is capped by `WORKER_MAX_CONCURRENT_RENDERS` (default 2 on a 4-OCPU box). HyperFrames itself spawns `--workers auto` chrome processes per render, so 2×3 = 6 chrome workers under heavy load is the upper bound.

### 8.1 Worker Dockerfile (ARM64 baked image)

```dockerfile
FROM --platform=linux/arm64 node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates fonts-liberation \
    libasound2 libatk-bridge2.0-0 libatk1.0-0 libatspi2.0-0 \
    libcairo2 libcups2 libdbus-1-3 libdrm2 libgbm1 libglib2.0-0 \
    libnspr4 libnss3 libpango-1.0-0 libx11-6 libxcb1 libxcomposite1 \
    libxdamage1 libxext6 libxfixes3 libxkbcommon0 libxrandr2 \
    wget xdg-utils ffmpeg \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json pnpm-lock.yaml ./
COPY pnpm-workspace.yaml turbo.json ./
COPY packages ./packages
COPY apps/worker ./apps/worker
RUN corepack enable && corepack prepare pnpm@latest --activate && pnpm install --frozen-lockfile
RUN pnpm --filter @hyperframe-editor/worker build

# Pre-download chrome-headless-shell for ARM
RUN cd apps/worker && npx --no-install hyperframes browser ensure

CMD ["node", "apps/worker/dist/index.js"]
```

We use the **OS** ffmpeg (Debian's apt package is fine for ARM) instead of `ffmpeg-static` because `ffmpeg-static` doesn't ship an ARM64 binary on all platforms. We confirm `ffmpeg -version` in the image during build.

### 8.2 Why we don't run HyperFrames' `@hyperframes/producer` HTTP server directly

We considered just running `node packages/producer/src/server.ts` from upstream HyperFrames as the worker. It works — but it's render-only, with no agent loop, and we'd need a sidecar process anyway. Easier to embed the producer as a library (`createRenderJob` + `executeRenderJob` from `@hyperframes/producer`'s programmatic API) inside our orchestrator.

---

## 9. Vertex AI integration

### 9.1 Auth

Service account JSON via `GOOGLE_APPLICATION_CREDENTIALS` mounted into the worker. Vercel has a single short-scoped service account for the small Vertex calls done from the API edge (intent classification only).

### 9.2 Model routing

| Use | Model | Why |
| --- | --- | --- |
| Intent classification | `gemini-2.5-flash` | cheap, sub-second |
| Storyboard / design / plan | `gemini-3.1-pro` | strong reasoning, 1M ctx |
| Long-video transcription + scene analysis | `gemini-3.1-pro` (audio + video parts) | native multimodal, no separate Whisper |
| Composition HTML synthesis | `gemini-3.1-pro` (with self-heal loop) | strict schema, lint-driven retries |
| Tool-calling | `gemini-3.1-pro` | function calling support |
| Image generation (hero shots, B-roll, thumbnails) | `gemini-3-pro-image` (Nano Banana Pro) | up to 4K, strong text rendering |
| Image generation (lots of variations, cheap) | `imagen-4.0-fast-generate-001` | fastest, cheapest |
| Voiceover TTS | Vertex Live API or `text-to-speech` v1 | low-latency, multilingual |

### 9.3 Long-video pattern (the video-use trick, adapted)

For inputs > 5 minutes, we **don't** send the raw video to Gemini. We do:

1. `extract_audio` → 16-kHz mono wav
2. Send the wav to Gemini 3.1 Pro with a structured prompt asking for word-level timestamps + speaker labels + scene-change cues. (Gemini supports audio input directly, no need for ElevenLabs Scribe.)
3. Pack the result into a `takes_packed.md` style markdown view (~10–15 KB).
4. Run reasoning over the packed view; only attach **one frame thumbnail** at decision-point timecodes (via `ffmpeg -ss <t> -frames:v 1`).
5. The composition references the original video path and uses `<video data-start data-duration data-playback-offset>` for trims — no re-encode of the source until final render.

This means a 10-minute interview can be planned with a single ~12 KB context, even though we technically have a 1M token budget.

### 9.4 Image generation guidance to the model

Image prompts include: aspect ratio (matched to canvas), palette tokens, "no text in image" (we render text in HTML), and a negative prompt for "watermark, blurry, low quality". Output is fetched as PNG, downscaled if >2× canvas dim, and stored at `oci://bucket/projects/<id>/assets/gen-<hash>.png` for caching.

---

## 10. Stock media providers

Priority order: **Pixabay → Unsplash → Freepik**. The first two cover most needs for free; Freepik is the paid escape hatch.

### 10.1 Pixabay

- Free key, ~100 req/min. Returns images and videos with HD/4K.
- No attribution required (Pixabay license).
- Endpoint: `GET https://pixabay.com/api/?key=...&q=...&video_type=film` or omit `video_type` for images.
- Cached results in Postgres for 24 h (search query → hit IDs).

### 10.2 Unsplash

- Free demo tier, 50 req/hour (we'll request production access at launch).
- **Attribution required** — agent must record `photographer.name` + profile URL into project metadata; the editor surfaces an "Attribution" tab that lists all Unsplash assets used.
- Images only.
- Endpoint: `GET https://api.unsplash.com/search/photos?query=...` with `Authorization: Client-ID <KEY>`.

### 10.3 Freepik

- Pay-as-you-go credits (5 EUR free trial). We expose Freepik only when user supplies their own key (BYOK). Same endpoints provide stock + AI gen + Magnific upscale.

### 10.4 Asset cache

Every downloaded asset is hashed (sha256) and stored once at `oci://bucket/asset-cache/<hash>.<ext>`. The DB table `cached_assets` maps hash → original URL → license info → first-seen timestamp.

---

## 11. Cost model and budgets

Per project default cap: **$1.00**. Per user monthly cap: **$10**. Configurable.

Cost rates (May 2026, indicative — verified at build time):

| Provider | Rate |
| --- | --- |
| Gemini 3.1 Pro (preview) | input ~$1.25/M tokens, output ~$10/M tokens (Vertex preview pricing) |
| Gemini 2.5 Flash | input ~$0.075/M, output ~$0.30/M |
| Nano Banana Pro image | ~$0.05–0.20/image depending on resolution |
| Imagen 4 fast | ~$0.02/image |
| Pixabay / Unsplash | $0 |
| Freepik | per credits (BYOK only) |
| Render | "free" — Oracle Free Tier — but we still charge ourselves a notional $0.001/render-second to keep the cost ledger honest |

The orchestrator computes a pre-flight estimate before starting any expensive step and writes a `cost_events` row after it completes. The editor surfaces running cost in the top bar.

---

## 12. Security

- **Service account scoping.** Vertex SA only allowed `aiplatform.user`. OCI key only allowed the project's bucket prefix.
- **Signed upload URLs.** Browser uploads go straight to OCI via pre-signed PUT URLs — never through Vercel functions.
- **CSP.** `<hyperframes-player>` runs untrusted user-generated HTML in an iframe with `sandbox="allow-scripts"` only — no `allow-same-origin`. Renderer Chrome runs with `--no-sandbox` only inside the locked-down container, never on a multi-tenant box.
- **API keys.** Vertex / Pixabay / Unsplash keys live as Vercel env vars (frontend-side has none — all stock searches go through `/api/stock/...`). Freepik key is BYOK per-user, encrypted at rest with `pgcrypto`.
- **Composition lint** rejects `eval`, `new Function`, network fetches at render time, and `repeat: -1` GSAP loops (which break determinism).
- **PII.** User-uploaded videos may contain faces; we never send them to a third party other than the user-chosen Vertex project and stock-search providers (which only see search queries, not the video).

---

## 13. Phased roadmap

### Phase 0 — Skeleton (Week 1)

Goal: a deployable empty shell.

- [ ] pnpm workspace, turbo, tsconfig.base, prettier, eslint
- [ ] Next.js 15 app with Tailwind, Zustand, basic auth (magic-link Resend)
- [ ] Postgres schema migrated (Drizzle or Prisma — pick one in implementation)
- [ ] OCI Object Storage adapter + signed URL endpoint
- [ ] Single placeholder editor route that loads `<hyperframes-player>` with a hardcoded composition
- [ ] Vercel deploy + Oracle worker placeholder that just prints `hello`

### Phase 1 — MVP: prompt → MP4 (Week 2–3)

Goal: replicate the Cloudflare-template magic, on our infra.

- [ ] `packages/compose/src/builder.ts` — minimal builder, one block (`HookTitle`), one preset (`tiktok-hook`).
- [ ] `packages/providers/vertex` — `generateText` + `generateImage` + `embed` wrappers.
- [ ] Worker compose loop: brief → plan → compose → lint → render. Self-heal up to 2x.
- [ ] `/api/agent/turn` SSE endpoint streaming the steps to the chat panel.
- [ ] `/api/render` queues to Redis, worker renders, MP4 lands in OCI, URL returned.
- [ ] Editor: chat panel + preview pane + "Render" button. No timeline yet.

**Demo-ready when:** user types "make a 30s reel about morning chai", picks `tiktok-hook`, watches steps stream, gets an MP4 in ~2 minutes.

### Phase 2 — Edit-source loop (Week 4–5)

Goal: drop a video, get a polished edit back.

- [ ] Source upload → OCI direct PUT.
- [ ] `tools.probe_media`, `tools.extract_audio`, `tools.transcribe` (Gemini audio).
- [ ] `tools.silence_cut`, `tools.auto_caption` (ffmpeg-driven, with sidecar SRT).
- [ ] Builder support for source-video clips with playback offsets.
- [ ] EDIT-SOURCE state machine end-to-end.
- [ ] Asset drawer for sources.

**Demo-ready when:** user uploads an 8-min interview, picks `podcast-clip`, gets a 60-second clip with TikTok-style captions in ~5 minutes.

### Phase 3 — Timeline editor (Week 6–7)

Goal: power users can manually polish.

- [ ] Canvas-based timeline component with drag/resize/track-move.
- [ ] Two-way bind to player time.
- [ ] Right-click context menu, basic clip operations.
- [ ] Apply-patch UX from agent suggestions.
- [ ] Asset drawer drag-to-timeline.
- [ ] Six more presets: `youtube-essay`, `youtube-short`, `devotional-reel`, `product-promo`, `educational-explainer`, `webinar-recap`.
- [ ] At least 25 blocks in the library.

### Phase 4 — Polish + ops (Week 8+)

- [ ] Cost dashboard, budget alerts, free-tier guardrails.
- [ ] BYOK Freepik integration.
- [ ] Multi-language support (Hindi/Devanagari fonts, RTL handling).
- [ ] `data-story` and `podcast-clip` chart blocks.
- [ ] Background-removal preview using HyperFrames' built-in tool.
- [ ] HDR / 4K / transparent-WebM export options.
- [ ] Optional MCP server export so power users can drive the editor from Claude Code / Cursor.
- [ ] OpenAPI export of the public API.

---

## 14. Build this first (the next 7 days)

A concrete, opinionated week-1 checklist. This is the only part of the doc that should be executed without re-reading the whole plan.

1. **Day 1.** Set up the monorepo. Push to GitHub. Wire Vercel preview deployments. Provision an Oracle A1 instance (4 OCPU/24 GB), open ports 22 + 443, install Docker.
2. **Day 2.** Stand up Postgres (Neon free) and Redis (Upstash free or self-hosted on Oracle). Apply the schema in §3. Wire Drizzle ORM in `packages/core/src/db.ts`.
3. **Day 3.** Build the worker Dockerfile (§8.1). On Oracle, `docker compose up -d worker postgres redis`. Have it consume a hardcoded queue message and log "ok".
4. **Day 4.** Implement `packages/providers/vertex/src/text.ts` and `image.ts`. Smoke-test with `gemini-3.1-pro` from the worker host using a service-account JSON.
5. **Day 5.** Implement the minimum compose loop in the worker: WRITE_BRIEF → PLAN_BEATS → COMPOSE → LINT (self-heal) → RENDER. Use one preset (`tiktok-hook`) and one block (`HookTitle`). Smoke-test end-to-end with a curl that posts a prompt and gets back an MP4 URL.
6. **Day 6.** Build the minimum Vercel app: a single editor route showing a chat box and a preview pane. SSE-stream the worker's events into the chat. Render button posts to `/api/render`.
7. **Day 7.** Hook OCI Object Storage. Replace local-disk artifact paths with `oci://...` everywhere. Verify the rendered MP4 URL works in a browser. Demo to yourself: prompt → MP4. Ship.

Everything in §13 Phase 2+ is downstream of this skeleton landing.

---

## 15. Open questions to revisit before Phase 1

- Auth: Clerk vs roll-our-own magic-link via Resend? (Resend is cheaper & simpler; Clerk is faster to build.)
- Drizzle vs Prisma? (Drizzle for ARM Docker simplicity.)
- Should the worker be one process per render, or a long-lived process with a worker pool? (Decision: long-lived pool, with each render in a child process so a Chrome crash kills only that child.)
- Do we want a public MCP server in V1, or wait until V2? (Decision: V2.)
- Studio embedding: do we ever pull in `@hyperframes/studio` directly, or always build our own? (Decision: always our own. Studio is a strong inspiration but coupled to HyperFrames' own dev loop.)

---

**Last edited:** May 14, 2026. This file is intentionally opinionated; if a decision changes, edit it here first, then change the code.
