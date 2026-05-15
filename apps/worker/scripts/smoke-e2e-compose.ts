/**
 * End-to-end smoke test for the full compose loop (offline mode).
 *
 * Exercises: writeBrief → planBeats → acquireAssets → compose → lint
 * Proves the entire agent pipeline produces lint-clean HTML from a user prompt.
 *
 * Does NOT require: ffmpeg, Chromium, Vertex AI, Pixabay, Redis, Postgres, S3.
 * Runs with: WORKER_OFFLINE_STUBS=1
 */
import { writeBrief } from "../src/agents/writeBrief.js";
import { planBeats } from "../src/agents/planBeats.js";
import { acquireAssets } from "../src/agents/acquireAssets.js";
import { lintHtml } from "../src/agents/lintHeal.js";
import { getPreset, computeDuration, type Composition } from "@hyperframe-editor/core";
import { buildCompositionHtml } from "@hyperframe-editor/compose";
import { setEventTap, type JobEvent } from "@hyperframe-editor/queue";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Beat } from "@hyperframe-editor/core";

const events: JobEvent[] = [];
setEventTap((_id, e) => events.push(e));

const prompt = "Create a 30 seconds intro video on HeyGen";
const preset = getPreset("tiktok-hook");

console.log("═══ E2E COMPOSE LOOP (offline stubs) ═══\n");

// 1. WRITE_BRIEF
console.log("1. WRITE_BRIEF");
const briefRes = await writeBrief({ prompt, preset });
console.log(`   title: "${briefRes.brief.title}"`);
console.log(`   summary: "${briefRes.brief.summary.slice(0, 80)}…"`);
console.log(`   mandates: [${briefRes.brief.mandates.join(", ")}]`);
console.log(`   usage: ${briefRes.usage ? `${briefRes.usage.tokensIn}in/${briefRes.usage.tokensOut}out` : "offline (no cost)"}`);

// 2. PLAN_BEATS
console.log("\n2. PLAN_BEATS");
const planRes = await planBeats({ brief: briefRes.brief, preset });
const totalDur = planRes.beats.reduce((a, b) => a + b.duration, 0);
console.log(`   beats: ${planRes.beats.length}, total: ${totalDur.toFixed(1)}s`);
for (const b of planRes.beats) {
  console.log(`     • ${b.id} (${b.duration}s) blocks=[${b.blocks.join(",")}] cues=${b.assetCues.length}`);
}

// 3. ACQUIRE_ASSETS
console.log("\n3. ACQUIRE_ASSETS");
const workDir = await mkdtemp(join(tmpdir(), "hf-e2e-"));
await mkdir(join(workDir, "assets"), { recursive: true });
const acquired = await acquireAssets({
  beats: planRes.beats,
  workDir,
  freeOnly: true,
  publish: async (msg) => console.log(`     ${msg}`),
});
console.log(`   acquired: ${acquired.assets.length} asset(s)`);

// 4. COMPOSE
console.log("\n4. COMPOSE (beatsToComposition + buildCompositionHtml)");
const clips: Composition["clips"] = [];
let t = 0;
for (let i = 0; i < planRes.beats.length; i++) {
  const b = planRes.beats[i]!;
  const block = b.blocks[0] ?? "HookTitle";
  clips.push({
    id: `${b.id}-${i}`,
    kind: "block",
    block,
    trackIndex: 0,
    start: Number(t.toFixed(3)),
    duration: Number(b.duration.toFixed(3)),
    playbackOffset: 0,
    props: propsForBlock(block, b),
  });
  t += b.duration;
}
const composition: Composition = {
  id: "e2e-test",
  canvas: preset.canvas,
  duration: 0,
  assets: [],
  clips,
  variables: {},
};
composition.duration = computeDuration(composition);
const html = buildCompositionHtml({ preset, composition });
console.log(`   HTML: ${html.length} bytes`);
console.log(`   duration: ${composition.duration}s`);
console.log(`   clips: ${composition.clips.length}`);

// 5. LINT
console.log("\n5. LINT");
const errors = lintHtml(html);
if (errors.length === 0) {
  console.log("   ✓ 0 errors — composition is lint-clean");
} else {
  console.log(`   ✗ ${errors.length} error(s):`);
  for (const e of errors) console.log(`     • [${e.rule}] ${e.message}`);
}

// Cleanup
await rm(workDir, { recursive: true, force: true });

// Result
console.log("\n═══════════════════════════════════════════");
if (errors.length === 0) {
  console.log("✅ FULL COMPOSE LOOP PASSES end-to-end");
  console.log("   prompt → brief → beats → assets → composition → lint ✓");
  console.log("   (render + gates require ffmpeg — tested separately in CI)");
} else {
  console.log("❌ COMPOSE LOOP FAILED — lint errors detected");
  process.exit(1);
}

function propsForBlock(block: string, beat: Beat): Record<string, unknown> {
  const narration = beat.narration ?? "";
  switch (block) {
    case "HookTitle":
      return { text: narration || "Hook", subtext: undefined };
    case "EndCard":
      return { cta: narration || "Subscribe" };
    case "KineticHeadline":
      return {
        words: (narration || beat.id).split(/\s+/).filter(Boolean).slice(0, 8),
      };
    case "QuoteCard":
      return { quote: narration || "—", attribution: undefined };
    case "LowerThird":
      return { name: narration || "Speaker", title: undefined };
    case "LogoBug":
      return { handle: "@hyperframeeditor" };
    case "CaptionBlock":
      return { lines: [], style: "tiktok" };
    case "KenBurnsImage":
      return { src: undefined, direction: "in" };
    case "BRollWindow":
      return { src: undefined };
    case "SplitScreen":
      return { left: undefined, right: undefined };
    default:
      return {};
  }
}
