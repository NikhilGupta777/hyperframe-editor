/**
 * Complete HyperFrames knowledge base for the video editing agent.
 *
 * Sources: Official HyperFrames documentation (hyperframes.heygen.com),
 * GitHub source (heygen-com/hyperframes), mintlify docs, and prompt guide.
 *
 * This file is the single source of truth the agent reads before generating
 * or editing any composition. It covers:
 *   - HTML schema reference (all clip types, all attributes)
 *   - GSAP animation rules
 *   - Common mistakes and how to avoid them
 *   - Determinism contract
 *   - Prompting vocabulary (motion, captions, transitions)
 *   - Output checklist
 */

// ---------------------------------------------------------------------------
// HTML SCHEMA REFERENCE
// ---------------------------------------------------------------------------
export const HTML_SCHEMA_REFERENCE = `
## HyperFrames HTML Schema

HyperFrames uses HTML as the source of truth for video:
- HTML clips = video, image, audio, composition
- Data attributes = timing, metadata, styling
- CSS = positioning and appearance
- GSAP timeline = animations and playback sync

### Framework-Managed Behavior (DO NOT replicate in scripts)
The framework automatically manages:
- Primitive clip timeline entries (reads data-start, data-duration, data-track-index)
- Media playback (play, pause, seek) for <video> and <audio>
- Clip lifecycle (mount/unmount based on data-start and data-duration)
- Timeline synchronization
- Media loading (waits for all media before rendering)

### All Clip Attributes

| Attribute | Required | Description |
|-----------|----------|-------------|
| id | Yes | Unique identifier (e.g., "el-1") |
| class="clip" | Yes (visible elements) | Enables runtime visibility. OMIT for audio and video. |
| data-start | Yes | Start time in seconds or a clip ID reference for relative timing |
| data-duration | See below | Duration in seconds. REQUIRED for images. Optional for video/audio. NOT used on compositions. |
| data-track-index | Yes | Timeline track number. Higher = in front. Same track clips cannot overlap. |
| data-media-start | No | Playback offset / trim point in source (seconds). Default: 0 |
| data-volume | No | Volume 0 to 1. Default: 1 |
| data-composition-id | On compositions | Must match window.__timelines key |
| data-composition-src | No | Path to external composition HTML |
| data-variable-values | No | JSON of values passed to nested composition |
| data-width | On compositions | Composition width px |
| data-height | On compositions | Composition height px |

### Clip Types

VIDEO:
- data-duration OPTIONAL (defaults to remaining source from data-media-start)
- If source runs out before data-duration, shows last frame (freeze)
- data-media-start trims the beginning of source video
- Do NOT add class="clip" to video elements (framework manages them directly)
- NEVER animate width/height/top/left on <video> — wrap in <div> and animate wrapper

IMAGE:
- data-duration REQUIRED
- class="clip" REQUIRED
- Supported: PNG, JPG, WebP, SVG, GIF (first frame only)

AUDIO:
- data-duration OPTIONAL (defaults to remaining source)
- Do NOT add class="clip" (invisible)
- Multiple audio clips can overlap on different tracks

COMPOSITION (nested):
- Do NOT use data-duration (comes from timeline's tl.duration())
- External compositions loaded from data-composition-src use <template> wrapper
- Framework auto-nests sub-timelines — never manually add

### Relative Timing
Reference another clip's ID in data-start = "start when that clip ends":
  <video id="intro" data-start="0" data-duration="10" ...>
  <video id="main" data-start="intro" data-duration="20" ...>
Offsets: data-start="intro + 2" (gap) or data-start="intro - 0.5" (overlap)

### Timeline Contract
- window.__timelines = {} initialized by framework
- Every composition registers: window.__timelines["<data-composition-id>"] = tl;
- All timelines MUST start paused: gsap.timeline({ paused: true })
- Framework auto-nests sub-timelines into parent
- Duration = tl.duration() — do NOT add data-duration on compositions
- Timelines must be finite (no infinite loops/repeats)
- Key MUST exactly match data-composition-id attribute
`;

// ---------------------------------------------------------------------------
// GSAP ANIMATION RULES
// ---------------------------------------------------------------------------
export const GSAP_ANIMATION_RULES = `
## GSAP Animation Rules for HyperFrames

### Setup Pattern (every composition needs this)
\`\`\`javascript
const tl = gsap.timeline({ paused: true });
tl.to("#title", { opacity: 1, duration: 0.5 }, 0); // position param = absolute time
window.__timelines = window.__timelines || {};
window.__timelines["<data-composition-id>"] = tl;
\`\`\`

### Key Rules
1. ALWAYS create timelines with { paused: true }
2. Register on window.__timelines with data-composition-id as key
3. Use the POSITION PARAMETER (3rd arg) for absolute timing: tl.to(el, vars, 1.5)
4. Only animate VISUAL properties — never control media playback

### Supported Methods
- tl.to(target, vars, position) — animate TO values
- tl.from(target, vars, position) — animate FROM values
- tl.fromTo(target, fromVars, toVars, position) — explicit from/to (PREFERRED)
- tl.set(target, vars, position) — set values instantly

### Supported Properties
opacity, x, y, scale, scaleX, scaleY, rotation, width, height, visibility,
color, backgroundColor, and any CSS-animatable property.

### Timeline Duration = Composition Duration
- Composition is exactly as long as the GSAP timeline
- If last animation ends at 8s but video is 283s, composition is only 8s!
- FIX: Add tl.set({}, {}, 283) to extend timeline without affecting elements

### FORBIDDEN patterns
- video.play(), video.pause(), audio.currentTime = X (framework owns playback)
- gsap.timeline() without { paused: true }
- tl.to("#el-video", { width: 500, height: 280 }) — animate wrapper div instead
- Manually nesting sub-timelines: masterTL.add(subTL, 0) — framework does this
- Math.random() without seeded PRNG
- Date.now(), performance.now()
- setTimeout, setInterval, requestAnimationFrame
- repeat: -1 (infinite loops)
- fetch() or network requests during timeline setup
`;

// ---------------------------------------------------------------------------
// COMMON MISTAKES
// ---------------------------------------------------------------------------
export const COMMON_MISTAKES = `
## Common Mistakes (not caught by linter)

### 1. Animating video element dimensions
BROKEN: tl.to("#el-video", { width: 500, height: 280, top: 700 }, 26);
FIX: Wrap video in a <div>, animate the wrapper. Video fills at 100%.

### 2. Controlling media playback in scripts
BROKEN: document.getElementById("el-video").play();
FIX: Don't control media. Framework handles it via data-start/data-media-start/data-volume.

### 3. Composition duration shorter than video
BROKEN: Last GSAP tween ends at 8s, video is 283s → composition is only 8s!
FIX: Add tl.set({}, {}, 283) at the end to extend timeline.

### 4. Missing class="clip" on timed elements
BROKEN: <h1 data-start="2" data-duration="5"> — always visible!
FIX: <h1 class="clip" data-start="2" data-duration="5"> — runtime manages visibility.
NOTE: Video elements do NOT get class="clip" (framework manages them).

### 5. Oversized source images
BROKEN: 7000x5000 JPEG = 140MB decoded RGBA in Chrome = stuttering.
FIX: Resize images to max 2x canvas (3840x2160 for 1080p composition).

### 6. Heavy backdrop-filter stacks
BROKEN: 8 stacked blur layers per side = 16 blur passes every frame.
FIX: Max 2-3 stacked layers, avoid radii above 64px over large areas.

### 7. Timeline key doesn't match data-composition-id
BROKEN: HTML says data-composition-id="my-video", script registers window.__timelines["root"]
FIX: Key must EXACTLY match the data-composition-id attribute.

### Debugging Checklist (in order)
1. Run linter (npx hyperframes lint)
2. Timeline registered? Key matches data-composition-id?
3. GSAP-only animations? (no media playback control)
4. Timeline long enough? (tl.set({}, {}, DURATION) at end)
5. Console errors?
`;

// ---------------------------------------------------------------------------
// DETERMINISM CONTRACT
// ---------------------------------------------------------------------------
export const DETERMINISM_CONTRACT = `
## Determinism Rules

HyperFrames guarantee: same composition always produces the same video.

Rendering pipeline: Frame Clock → Seek → Capture → Encode
- Frame clock: t = floor(frame) / fps — NO wall-clock dependency
- Seek: frame adapter positions all animations to exact frame
- Capture: Chrome's HeadlessExperimental.beginFrame — atomic, no partial paints
- Encode: FFmpeg encodes frames + mixes audio

What makes it deterministic:
- No wall-clock: no Date.now(), requestAnimationFrame, system timers
- No unseeded random: Math.random() without seed breaks determinism
- No render-time network: all assets must be loaded before render starts
- Fixed params: fps, width, height locked before first frame
- Finite duration: every composition has known, finite length

NEVER use in compositions:
- Math.random() (use seeded mulberry32 PRNG if needed)
- Date.now(), performance.now()
- setTimeout, setInterval, requestAnimationFrame
- fetch(), XMLHttpRequest during render
- Infinite animations (repeat: -1)
`;

// ---------------------------------------------------------------------------
// PROMPTING VOCABULARY
// ---------------------------------------------------------------------------
export const PROMPTING_VOCABULARY = `
## Agent Vocabulary → Technical Mapping

### Motion & Easing
| User says | Use GSAP ease | Feels like |
|-----------|---------------|------------|
| smooth | power2.out | Natural deceleration |
| snappy | power4.out | Quick and decisive |
| bouncy | back.out | Overshoots then settles |
| springy | elastic.out | Oscillates into place |
| dramatic | expo.out | Fast start, long glide |
| dreamy | sine.inOut | Slow, symmetrical |

Timing: fast=0.2s (energy), medium=0.4s (professional), slow=0.6s (luxury), very slow=1-2s (cinematic)

### Caption Tones
| Tone | Typography | Animation | Size |
|------|-----------|-----------|------|
| Hype | Heavy weight | Scale-pop | 72-96px |
| Corporate | Clean sans | Fade+slide | 56-72px |
| Tutorial | Monospace | Typewriter | 48-64px |
| Storytelling | Serif | Slow fade | 44-56px |
| Social | Rounded playful | Bounce | 56-80px |

### Transitions
| Energy | CSS option | Shader option |
|--------|-----------|---------------|
| Calm | Blur crossfade | Cross-warp morph |
| Medium | Push slide | Whip pan |
| High | Zoom through | Glitch, ridged burn |

### Marker/Highlight Effects
| Mode | Effect | Best for |
|------|--------|----------|
| highlight | Marker sweep | Key phrases |
| circle | Hand-drawn ellipse | Single words |
| burst | Radiating lines | Hype moments |
| scribble | Chaotic scratch | Crossing out |

### Design Best Practices
- Entrance animations on EVERY scene (elements appearing without animation feel broken)
- Transitions between EVERY scene (jump cuts are almost always unintentional)
- Three-phase pacing per beat: build (fast in) → breathe (hold) → resolve (gentle exit)
- Stagger entrances by ~80ms between elements
- Typography: clamp() font sizes, tight letter-spacing on display, line-height 0.95 on headlines
- Layered depth: multi-layer box-shadow, soft gradients, never single flat colour
- Captions inside safe area: 5% inset for 16:9, 8% for 9:16
`;

// ---------------------------------------------------------------------------
// OUTPUT CHECKLIST
// ---------------------------------------------------------------------------
export const OUTPUT_CHECKLIST = `
## Output Checklist (verify before render)

□ Every composition has data-width and data-height on root element
□ Root element has data-composition-id matching window.__timelines key
□ All GSAP timelines are { paused: true } and registered in window.__timelines
□ Timed VISIBLE elements (images, divs, headings) have class="clip"
□ Video elements do NOT have class="clip"
□ data-start references point to existing clip IDs
□ Timeline extended with tl.set({}, {}, totalDuration) to match full composition length
□ No Math.random, Date.now, setTimeout, setInterval, requestAnimationFrame
□ No fetch() or network requests at render time (only CDN scripts allowed: gsap + runtime)
□ No repeat:-1 in GSAP (must be finite)
□ Only two CDN scripts: gsap (cdn.jsdelivr.net) and hyperframes runtime
□ Video dimensions animated via wrapper div, never directly
□ tl.fromTo preferred over tl.from (immediateRender breaks seeking)
□ Images sized to max 2x canvas dimensions
□ All media references are relative paths or pre-loaded assets
`;

// ---------------------------------------------------------------------------
// RENDERING & PRODUCER KNOWLEDGE
// ---------------------------------------------------------------------------
export const RENDERING_KNOWLEDGE = `
## Rendering Pipeline

The producer orchestrates: Load HTML → Inject runtime → Wait for readiness gates
→ Capture frames (BeginFrame API) → Encode (FFmpeg) → Mix audio

### Programmatic API (what our worker uses)
import { createRenderJob, executeRenderJob } from "@hyperframes/producer";

const job = createRenderJob({
  input: "./composition/index.html",  // or projectDir path
  output: "./output.mp4",
  fps: 30,
  quality: "standard",  // "draft" | "standard" | "high"
  format: "mp4",        // "mp4" | "webm" | "mov"
  workers: "auto",
  useGpu: false,
});
const result = await executeRenderJob(job);

### Quality presets
| Preset | CRF | x264 preset | Use for |
|--------|-----|-------------|---------|
| draft | 28 | ultrafast | Fast iteration |
| standard | 18 | medium | General use (visually lossless at 1080p) |
| high | 15 | slow | Final delivery |

### Workers
Each worker = 1 Chrome process (~256MB RAM). Default = half CPU cores capped at 4.
- Short compositions (<2s): use 1 worker (parallelism overhead exceeds benefit)
- Long compositions (30s+): use 4+ workers on 8+ core machines

### Transparent video (for overlays)
- format: "webm" → VP9 with alpha channel
- format: "mov" → ProRes 4444 with alpha (for video editors)
- Do NOT set background on html/body — leave transparent

### 4K rendering
- Pass --resolution 4k → Chrome renders at 2x DPR → 3840x2160 output
- No composition edits needed — supersamples automatically
- Text, SVG, CSS shapes benefit from 4K; bitmap sources stay at their native resolution

### HDR rendering (when HDR sources present)
- Auto-detected from source media color metadata (BT.2020 + PQ/HLG)
- Output: H.265 10-bit BT.2020 with HDR10 static metadata
- Only MP4 format supports HDR; MOV/WebM fall back to SDR
`;

// ---------------------------------------------------------------------------
// PLAYER & PREVIEW KNOWLEDGE
// ---------------------------------------------------------------------------
export const PLAYER_KNOWLEDGE = `
## @hyperframes/player Web Component

The embeddable player for previewing compositions in any web page:

<hyperframes-player
  src="./composition/index.html"
  controls
  autoplay
  muted
  style="width: 100%; aspect-ratio: 16/9"
></hyperframes-player>

### Attributes
| Attribute | Default | Description |
|-----------|---------|-------------|
| src | required | URL/path to composition HTML |
| width | 1920 | Composition width |
| height | 1080 | Composition height |
| controls | false | Show playback controls |
| autoplay | false | Start playing on load |
| loop | false | Loop playback |
| muted | true | Mute audio |
| playback-rate | 1 | Speed multiplier |

### JavaScript API (mirrors <video>)
player.play() / player.pause() / player.seek(2.5)
player.currentTime / player.duration / player.paused / player.ready

### Events
ready, timeupdate, play, pause, ended, error
`;

// ---------------------------------------------------------------------------
// VARIABLES SYSTEM
// ---------------------------------------------------------------------------
export const VARIABLES_KNOWLEDGE = `
## HyperFrames Variables

Parameterize compositions so the same source renders different content.

### Declare variables on the <html> root:
<html data-composition-variables='[
  {"id":"title","type":"string","label":"Title","default":"Hello"},
  {"id":"color","type":"color","label":"Color","default":"#111827"},
  {"id":"price","type":"number","label":"Price","default":0,"unit":"$"},
  {"id":"featured","type":"boolean","label":"Featured","default":false}
]'>

### Read variables in composition scripts:
const { title, color } = __hyperframes.getVariables();
root.querySelector(".title").textContent = title;
root.style.setProperty("--color", color);

### Pass per-instance values to nested compositions:
<div data-composition-src="card.html"
     data-variable-values='{"title":"Pro","color":"#ff4d4f"}'>
</div>

### Variable types: string, number, color, boolean, enum
`;

// ---------------------------------------------------------------------------
// WEBSITE-TO-VIDEO PIPELINE
// ---------------------------------------------------------------------------
export const WEBSITE_TO_VIDEO = `
## Website-to-Video Pipeline

Capture any URL → extract brand identity → write script + storyboard → build compositions → render.

Steps:
1. CAPTURE — screenshots, design tokens, fonts, assets, animations
2. DESIGN — brand reference (colors, typography, do's/don'ts)
3. SCRIPT — narration with hook, story, proof, CTA
4. STORYBOARD — per-beat creative direction
5. VO + TIMING — TTS audio with word-level timestamps
6. BUILD — animated HTML compositions per beat
7. VALIDATE — snapshot PNGs for visual verification

Video types and durations:
- Social ad: 10-15s
- Product launch: 20-30s
- Product tour: 30-60s
- Brand reel: 15-30s
- Feature announcement: 15-25s
- Teaser: 8-15s
`;

// ---------------------------------------------------------------------------
// TIMELINE EDITING RULES
// ---------------------------------------------------------------------------
export const TIMELINE_EDITING = `
## Timeline Editing Model

### What the timeline can do:
- Move clips in time (updates data-start)
- Move clips between tracks (updates data-track-index)
- Change visual stacking (higher rows = in front, updates z-index)
- Trim end of clip (right handle → updates data-duration)
- Trim start of MEDIA clips (left handle → updates data-start + data-media-start)

### How edits map to HTML:
- Horizontal move → data-start
- Vertical move → data-track-index
- Right trim → data-duration
- Media left trim → data-start + data-media-start

### Current limitations:
- No true front trim for generic motion/DOM clips (only media clips)
- No split, slip, slide, ripple, or roll editing yet
- Layering driven by row order + inline z-index
`;

// ---------------------------------------------------------------------------
// LINTER REFERENCE
// ---------------------------------------------------------------------------
export const LINTER_REFERENCE = `
## Composition Linter

import { lintHyperframeHtml } from "@hyperframes/core/lint";

const result = lintHyperframeHtml(html, { filePath: "index.html" });
// result.ok, result.errorCount, result.warningCount, result.findings

### What it catches:
- Missing timeline registration (window.__timelines)
- Unmuted video elements
- Missing class="clip" on timed visible elements
- Deprecated attribute names (data-layer, data-end)
- Missing composition dimensions (data-width, data-height)
- Invalid data-start references to nonexistent clip IDs
- Overlapping clips on the same track

### What it CANNOT catch (see Common Mistakes):
- Animating video dimensions directly
- Controlling media playback in scripts
- Timeline shorter than video duration
- Oversized images
- Heavy backdrop-filter stacks
`;

// ---------------------------------------------------------------------------
// BACKGROUND REMOVAL
// ---------------------------------------------------------------------------
export const BACKGROUND_REMOVAL = `
## Background Removal (transparent video)

CLI: npx hyperframes remove-background subject.mp4 -o transparent.webm

- Model: u2-net_human_seg (MIT, ~168MB ONNX)
- Output: VP9 with alpha (.webm) or ProRes 4444 (.mov)
- Best for: person/portrait video with contrasting background
- Performance: ~263ms/frame Apple Silicon, ~80-150ms/frame NVIDIA

### Usage in compositions:
<video src="transparent.webm" autoplay muted playsinline></video>

### Text-behind-subject pattern:
Layer 1 (z=1): base video (full frame)
Layer 2 (z=2): headline text
Layer 3 (z=3): cutout video (transparent background, subject on top)
Result: text appears BEHIND the person's silhouette
`;

/**
 * Combined knowledge for the agent's system prompt context.
 * Inject this before the composition task so the model has full HyperFrames expertise.
 */
export const FULL_HYPERFRAMES_KNOWLEDGE = [
  HTML_SCHEMA_REFERENCE,
  GSAP_ANIMATION_RULES,
  COMMON_MISTAKES,
  DETERMINISM_CONTRACT,
  PROMPTING_VOCABULARY,
  OUTPUT_CHECKLIST,
  RENDERING_KNOWLEDGE,
  PLAYER_KNOWLEDGE,
  VARIABLES_KNOWLEDGE,
  WEBSITE_TO_VIDEO,
  TIMELINE_EDITING,
  LINTER_REFERENCE,
  BACKGROUND_REMOVAL,
].join("\n\n");
