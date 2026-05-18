/**
 * Complete HyperFrames knowledge base for the composition agent.
 * This is injected into the Gemini system prompt so it knows EVERYTHING
 * about how to write correct, production-quality HyperFrames compositions.
 */

export const HYPERFRAMES_KNOWLEDGE = `
# HyperFrames Complete Reference

HyperFrames turns HTML into deterministic, frame-by-frame rendered video.
You define a video the same way you build a web page — HTML for structure,
CSS for styling, GSAP for animation. The renderer captures each frame via
Chrome's BeginFrame API.

## 1. COMPOSITION STRUCTURE

Every composition is an HTML document. The root element defines the video canvas:

\`\`\`html
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>/* styles */</style>
</head>
<body>
  <div id="root" data-composition-id="main"
       data-start="0" data-width="1920" data-height="1080">
    <!-- clips go here -->
  </div>
  <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/@hyperframes/core/dist/hyperframe.runtime.iife.js"></script>
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    // animations...
    tl.set({}, {}, TOTAL_DURATION); // extend timeline to match composition
    window.__timelines["main"] = tl;
  </script>
</body>
</html>
\`\`\`

## 2. CLIP TYPES

### Video Clips
\`\`\`html
<video id="el-1" class="clip" muted playsinline preload="auto"
       data-start="0" data-duration="10" data-track-index="0"
       data-media-start="0" src="assets/intro.mp4"></video>
\`\`\`
- MUST be muted (audio goes in separate <audio> elements)
- data-media-start = trim/offset point in source file
- data-duration is optional (defaults to source duration)
- DO NOT animate width/height on video elements directly — wrap in a div

### Image Clips
\`\`\`html
<img id="el-2" class="clip"
     data-start="0" data-duration="5" data-track-index="1"
     src="assets/photo.jpg" alt="">
\`\`\`
- data-duration is REQUIRED for images
- Use object-fit: cover for full-bleed backgrounds

### Audio Clips
\`\`\`html
<audio id="el-3" data-start="0" data-track-index="99"
       data-volume="0.6" src="assets/music.mp3"></audio>
\`\`\`
- No class="clip" needed (audio is invisible)
- data-volume: 0 to 1

### Composition Clips (animated divs)
\`\`\`html
<div id="title-scene" class="clip" data-start="0" data-duration="5" data-track-index="2">
  <h1 class="title">Hello World</h1>
</div>
\`\`\`

## 3. DATA ATTRIBUTES

### Timing
- data-start: seconds ("0", "5.5") or relative ("intro", "intro + 2", "intro - 0.5")
- data-duration: seconds (required for images, optional for video/audio)
- data-track-index: z-order layer (higher = in front). Same track = no overlap.

### Media
- data-media-start: playback offset in source (trim point)
- data-volume: 0 to 1
- data-has-audio: "true" if video has audio track

### Composition
- data-composition-id: unique ID (MUST match window.__timelines key)
- data-width / data-height: canvas size in pixels

## 4. RELATIVE TIMING

Reference another clip's ID to mean "start when that clip ends":
\`\`\`html
<video id="intro" data-start="0" data-duration="10" data-track-index="0" ...></video>
<video id="main" data-start="intro" data-duration="20" data-track-index="0" ...></video>
<video id="outro" data-start="main" data-duration="5" data-track-index="0" ...></video>
\`\`\`

Offsets for gaps/overlaps:
\`\`\`html
<!-- 2-second gap after intro -->
<div data-start="intro + 2" ...>
<!-- 0.5-second overlap (crossfade) — MUST be on different track -->
<div data-start="intro - 0.5" data-track-index="1" ...>
\`\`\`

## 5. GSAP ANIMATION RULES

### Setup
\`\`\`javascript
const tl = gsap.timeline({ paused: true }); // MUST be paused
// Use position parameter (3rd arg) for absolute timing:
tl.fromTo("#title", { opacity: 0, y: -50 }, { opacity: 1, y: 0, duration: 0.6, ease: "power2.out" }, 0);
tl.to("#title", { opacity: 0, duration: 0.4, ease: "power2.inOut" }, 4.6);
// Extend timeline to match total composition duration:
tl.set({}, {}, TOTAL_DURATION);
window.__timelines["main"] = tl;
\`\`\`

### Supported Methods
- tl.to(target, vars, position) — animate TO values
- tl.from(target, vars, position) — animate FROM values (use fromTo instead for seeking)
- tl.fromTo(target, fromVars, toVars, position) — PREFERRED, works with seeking
- tl.set(target, vars, position) — instant set

### Supported Properties
opacity, x, y, scale, scaleX, scaleY, rotation, width, height, color,
backgroundColor, borderRadius, clipPath, filter, backdropFilter, letterSpacing,
fontSize, and any CSS-animatable property.

### Easing Reference
- Smooth: "power2.out" — natural deceleration
- Snappy: "power4.out" — quick and decisive
- Bouncy: "back.out(1.4)" — overshoots then settles
- Springy: "elastic.out(1, 0.5)" — oscillates into place
- Dramatic: "expo.out" — fast start, long glide
- Dreamy: "sine.inOut" — slow, symmetrical
- Linear: "none" — constant speed (good for Ken Burns)

### CRITICAL RULES
1. Always { paused: true } — framework controls playback
2. Register on window.__timelines["<data-composition-id>"]
3. Use fromTo (not from) — from breaks deterministic seeking
4. Position parameter for absolute timing
5. NO Math.random, NO Date.now, NO setTimeout, NO setInterval
6. NO repeat: -1 (infinite loops break rendering)
7. NO requestAnimationFrame
8. Timeline duration MUST match composition duration
9. Never play/pause/seek media in scripts
10. Never animate video element dimensions directly

## 6. ANIMATION PATTERNS

### Ken Burns (slow zoom on images)
\`\`\`javascript
// Zoom in: 1.0 → 1.08 over the full duration
tl.fromTo("#bg-img", { scale: 1.0 }, { scale: 1.08, duration: 10, ease: "none" }, 0);
// Zoom out: 1.08 → 1.0
tl.fromTo("#bg-img", { scale: 1.08 }, { scale: 1.0, duration: 10, ease: "none" }, 0);
\`\`\`

### Kinetic Typography (staggered word reveal)
\`\`\`javascript
tl.fromTo(".word", { opacity: 0, y: 40 }, { opacity: 1, y: 0, duration: 0.4, stagger: 0.08, ease: "back.out(1.4)" }, 2);
\`\`\`

### Lower Third (slide in from left)
\`\`\`javascript
tl.fromTo("#lower-third", { x: -400, opacity: 0 }, { x: 0, opacity: 1, duration: 0.5, ease: "power3.out" }, 3);
tl.to("#lower-third", { x: -400, opacity: 0, duration: 0.4, ease: "power2.in" }, 7);
\`\`\`

### Scene Transition (crossfade)
\`\`\`javascript
// Scene A fades out while Scene B fades in (overlap by 0.5s)
tl.to("#scene-a", { opacity: 0, duration: 0.5, ease: "power2.inOut" }, 9.5);
tl.fromTo("#scene-b", { opacity: 0 }, { opacity: 1, duration: 0.5, ease: "power2.inOut" }, 9.5);
\`\`\`

### Scale Entrance (bouncy pop)
\`\`\`javascript
tl.fromTo("#card", { scale: 0.8, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.5, ease: "back.out(1.6)" }, 1);
\`\`\`

### Parallax (multi-layer depth)
\`\`\`javascript
tl.fromTo("#bg", { y: 0 }, { y: -30, duration: 10, ease: "none" }, 0);
tl.fromTo("#mid", { y: 0 }, { y: -60, duration: 10, ease: "none" }, 0);
tl.fromTo("#fg", { y: 0 }, { y: -100, duration: 10, ease: "none" }, 0);
\`\`\`

### Vignette (CSS-only, no animation needed)
\`\`\`css
.vignette {
  position: absolute; inset: 0; pointer-events: none;
  background: radial-gradient(ellipse at center, transparent 50%, rgba(0,0,0,0.7) 100%);
}
\`\`\`

### Film Grain (CSS keyframes)
\`\`\`css
.grain {
  position: absolute; inset: 0; pointer-events: none; opacity: 0.04;
  background-image: url("data:image/svg+xml,..."); /* noise pattern */
  animation: grain 0.5s steps(1) infinite;
}
@keyframes grain { 0%,100%{transform:translate(0)} 25%{transform:translate(-2%,2%)} 50%{transform:translate(2%,-1%)} 75%{transform:translate(-1%,-2%)} }
\`\`\`

## 7. MULTI-TRACK LAYERING

Track index controls z-order (higher = in front):
- Track 0: Background (full-bleed video/images with Ken Burns)
- Track 1: B-roll / secondary visuals
- Track 2: Content (text, cards, graphics)
- Track 3: Overlays (lower thirds, captions)
- Track 4: Effects (vignette, grain, color grade)

Clips on the SAME track CANNOT overlap in time.
Clips on DIFFERENT tracks CAN overlap (they layer visually).

## 8. TRANSITIONS BETWEEN SCENES

### Crossfade (most common)
Overlap two scenes by 0.3-0.5s on different tracks:
\`\`\`html
<div id="scene-1" class="clip" data-start="0" data-duration="10.5" data-track-index="0">...</div>
<div id="scene-2" class="clip" data-start="10" data-duration="10.5" data-track-index="1">...</div>
\`\`\`
\`\`\`javascript
tl.to("#scene-1", { opacity: 0, duration: 0.5 }, 10);
tl.fromTo("#scene-2", { opacity: 0 }, { opacity: 1, duration: 0.5 }, 10);
\`\`\`

### Scale Zoom Through
\`\`\`javascript
tl.to("#scene-1", { scale: 1.5, opacity: 0, duration: 0.4, ease: "power3.in" }, 10);
tl.fromTo("#scene-2", { scale: 0.8, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.4, ease: "power3.out" }, 10.2);
\`\`\`

### Slide Push
\`\`\`javascript
tl.to("#scene-1", { x: "-100%", duration: 0.5, ease: "power2.inOut" }, 10);
tl.fromTo("#scene-2", { x: "100%" }, { x: "0%", duration: 0.5, ease: "power2.inOut" }, 10);
\`\`\`

## 9. CSS BEST PRACTICES

\`\`\`css
*, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
html, body { width: WIDTHpx; height: HEIGHTpx; overflow: hidden; }
.composition { position: relative; width: 100%; height: 100%; overflow: hidden; }
.clip { position: absolute; inset: 0; overflow: hidden; }

/* Full-bleed background image */
.bg-img { width: 100%; height: 100%; object-fit: cover; }

/* Centered text */
.centered { display: flex; align-items: center; justify-content: center; text-align: center; }

/* Glass card */
.glass { backdrop-filter: blur(20px); background: rgba(255,255,255,0.1); border-radius: 16px; border: 1px solid rgba(255,255,255,0.2); }

/* Text readability over images */
.text-shadow { text-shadow: 0 2px 12px rgba(0,0,0,0.6), 0 0 40px rgba(0,0,0,0.3); }
\`\`\`

## 10. COMMON MISTAKES TO AVOID

1. DO NOT call video.play(), video.pause(), or set currentTime in scripts
2. DO NOT animate width/height on <video> elements — wrap in a div
3. DO NOT create timelines without { paused: true }
4. DO NOT use Math.random() — use deterministic values
5. DO NOT forget tl.set({}, {}, totalDuration) to extend timeline
6. DO NOT put overlapping clips on the same track
7. DO NOT forget class="clip" on visible timed elements
8. DO NOT use setTimeout, setInterval, or requestAnimationFrame
9. DO NOT manually nest sub-timelines (framework does this automatically)
10. DO NOT use repeat: -1 (infinite loops break rendering)

## 11. PRODUCTION QUALITY CHECKLIST

Before outputting a composition, verify:
- [ ] Root has data-composition-id, data-width, data-height, data-start
- [ ] Every visible timed element has class="clip", data-start, data-duration, data-track-index
- [ ] GSAP timeline created with { paused: true }
- [ ] Timeline registered as window.__timelines["main"]
- [ ] Timeline duration matches composition (tl.set({}, {}, totalDuration))
- [ ] All video elements are muted
- [ ] No Math.random, Date.now, setTimeout, setInterval
- [ ] No repeat: -1 or infinite loops
- [ ] Every element has entrance AND exit animations
- [ ] Transitions between scenes (no jump cuts)
- [ ] Ken Burns on all background images
- [ ] Text has text-shadow for readability
- [ ] Vignette overlay for cinematic feel
- [ ] Font loaded via Google Fonts link

## 12. EXAMPLE: COMPLETE CINEMATIC COMPOSITION

\`\`\`html
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700&family=Inter:wght@400;600&display=block" rel="stylesheet">
<style>
*, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
html, body { width: 1920px; height: 1080px; overflow: hidden; background: #0a0a0a; }
.composition { position: relative; width: 100%; height: 100%; overflow: hidden; }
.clip { position: absolute; inset: 0; overflow: hidden; }
.bg-img { width: 100%; height: 100%; object-fit: cover; }
.scene-title { display: flex; align-items: center; justify-content: center; flex-direction: column; }
.scene-title h1 { font-family: "Playfair Display", serif; font-size: 96px; color: #fff; text-shadow: 0 4px 24px rgba(0,0,0,0.6); }
.scene-title p { font-family: "Inter", sans-serif; font-size: 32px; color: rgba(255,255,255,0.8); margin-top: 16px; }
.vignette { position: absolute; inset: 0; pointer-events: none; background: radial-gradient(ellipse at center, transparent 40%, rgba(0,0,0,0.6) 100%); }
</style>
</head>
<body>
<div class="composition" data-composition-id="main" data-width="1920" data-height="1080" data-start="0" data-duration="20">

  <!-- Scene 1: Background image with Ken Burns -->
  <div id="scene-1" class="clip" data-start="0" data-duration="10.5" data-track-index="0">
    <img class="bg-img" src="assets/bg1.jpg" alt="">
  </div>

  <!-- Scene 1: Title overlay -->
  <div id="title-1" class="clip scene-title" data-start="0" data-duration="10" data-track-index="2">
    <h1>The Story Begins</h1>
    <p>A journey through visual storytelling</p>
  </div>

  <!-- Scene 2: Background video -->
  <div id="scene-2" class="clip" data-start="10" data-duration="10.5" data-track-index="1">
    <video class="bg-img" muted playsinline preload="auto" src="assets/clip1.mp4"></video>
  </div>

  <!-- Scene 2: Lower third -->
  <div id="lower-third" class="clip" data-start="11" data-duration="6" data-track-index="3"
       style="inset: auto 0 80px 60px; width: 400px; height: auto; padding: 16px 24px; background: rgba(0,0,0,0.7); backdrop-filter: blur(10px); border-radius: 8px;">
    <p style="font-family: Inter, sans-serif; font-size: 24px; color: #fff; font-weight: 600;">Chapter Two</p>
    <p style="font-family: Inter, sans-serif; font-size: 16px; color: rgba(255,255,255,0.7);">The visual journey continues</p>
  </div>

  <!-- Vignette overlay (always on top) -->
  <div class="vignette" data-start="0" data-duration="20" data-track-index="10"></div>

</div>

<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@hyperframes/core/dist/hyperframe.runtime.iife.js"></script>
<script>
window.__timelines = window.__timelines || {};
const tl = gsap.timeline({ paused: true });

// Scene 1: Ken Burns zoom on background
tl.fromTo("#scene-1 .bg-img", { scale: 1.0 }, { scale: 1.08, duration: 10.5, ease: "none" }, 0);

// Scene 1: Title entrance
tl.fromTo("#title-1 h1", { opacity: 0, y: 40 }, { opacity: 1, y: 0, duration: 0.8, ease: "power3.out" }, 0.5);
tl.fromTo("#title-1 p", { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 0.6, ease: "power2.out" }, 1.0);
// Title exit
tl.to("#title-1 h1", { opacity: 0, y: -30, duration: 0.5, ease: "power2.in" }, 9);
tl.to("#title-1 p", { opacity: 0, duration: 0.4, ease: "power2.in" }, 9.2);

// Transition: Scene 1 → Scene 2 (crossfade at t=10)
tl.to("#scene-1", { opacity: 0, duration: 0.5, ease: "power2.inOut" }, 10);
tl.fromTo("#scene-2", { opacity: 0 }, { opacity: 1, duration: 0.5, ease: "power2.inOut" }, 10);

// Scene 2: Lower third slide in
tl.fromTo("#lower-third", { x: -300, opacity: 0 }, { x: 0, opacity: 1, duration: 0.5, ease: "power3.out" }, 11);
tl.to("#lower-third", { x: -300, opacity: 0, duration: 0.4, ease: "power2.in" }, 16.5);

// Extend timeline to full duration
tl.set({}, {}, 20);
window.__timelines["main"] = tl;
</script>
</body>
</html>
\`\`\`

## 13. CAPTION STYLES

### Karaoke (word-by-word highlight)
Each word gets its own span, highlighted sequentially with a colored background sweep.

### Kinetic Slam
Full-screen single-word display with alternating entrance directions (left/right/top).

### Neon Glow
Text with CSS text-shadow glow effects in cyan/magenta.

### Editorial Emphasis
Dual-font system — large display font for key words, smaller body font for the rest.

## 14. AVAILABLE TRANSITIONS (use between scenes)

Calm: crossfade, blur dissolve, light leak
Medium: push slide, whip pan, scale zoom
High energy: glitch, ridged burn, shatter, chromatic split
Cinematic: domain warp dissolve, gravitational lens, thermal distortion

## 15. AUDIO-REACTIVE (advanced)

Map frequency bands to visual properties:
- Bass → scale (pulse on beat)
- Treble → glow intensity
- Amplitude → opacity (breathing)
- Mids → shape morphing

Keep effects subtle for text (3-6%), bigger for backgrounds (10-30%).
`;
