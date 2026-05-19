/**
 * Smoke test — deterministic, no network.
 *
 * Builds a composition AST from the tiktok-hook preset, runs it through the
 * builder, and asserts the produced HTML satisfies the load-bearing contract
 * (root attributes, single timeline, only the two allowed CDN scripts).
 *
 * This is the Day-1 acceptance test: if this passes, the composition pipeline
 * is wired correctly end-to-end and Day-2 can layer Postgres on top.
 */
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

import {
  type Composition,
  TIKTOK_HOOK,
  computeDuration,
} from "@hyperframe-editor/core";
import { buildCompositionHtml } from "@hyperframe-editor/compose";

const composition: Composition = {
  id: "smoke-1",
  canvas: TIKTOK_HOOK.canvas,
  duration: 6,
  assets: [],
  variables: {},
  clips: [
    {
      id: "hook-1",
      kind: "block",
      block: "HookTitle",
      trackIndex: 0,
      start: 0,
      duration: 3,
      playbackOffset: 0,
      props: {
        text: "Morning chai changes everything",
        subtext: "30s reel · day 1",
      },
    },
    {
      id: "cta-1",
      kind: "block",
      block: "EndCard",
      trackIndex: 0,
      start: 3,
      duration: 3,
      playbackOffset: 0,
      props: {
        cta: "Try it tomorrow",
        handle: "@hyperframeeditor",
      },
    },
  ],
};

composition.duration = computeDuration(composition);

const html = buildCompositionHtml({ preset: TIKTOK_HOOK, composition });

const checks: Array<[string, boolean]> = [
  ["DOCTYPE present", html.startsWith("<!DOCTYPE html>")],
  ["root data-composition-id", html.includes('data-composition-id="main"')],
  ["root data-width matches preset", html.includes(`data-width="${TIKTOK_HOOK.canvas.width}"`)],
  ["root data-height matches preset", html.includes(`data-height="${TIKTOK_HOOK.canvas.height}"`)],
  ["root data-duration is total", html.includes(`data-duration="${composition.duration.toFixed(3)}"`)],
  ["paused timeline", /gsap\.timeline\(\s*\{\s*paused:\s*true\s*\}\s*\)/.test(html)],
  ["timeline registered on window.__timelines", html.includes('window.__timelines["main"] = tl;')],
  ["uses tl.fromTo, not tl.from", /tl\.fromTo\(/.test(html) && !/[^a-zA-Z]tl\.from\(/.test(html)],
  ["no Math.random", !html.includes("Math.random")],
  ["no Date.now", !html.includes("Date.now")],
  ["no setTimeout", !/setTimeout\s*\(/.test(html)],
  ["no setInterval", !/setInterval\s*\(/.test(html)],
  ["no requestAnimationFrame", !/requestAnimationFrame\s*\(/.test(html)],
  ["no repeat:-1", !/repeat:\s*-1/.test(html)],
  ["both clips have class=clip", (html.match(/class="clip /g) || []).length === 2],
  ["track index attribute present", html.includes('data-track-index="0"')],
  ["GSAP CDN script", html.includes("cdn.jsdelivr.net/npm/gsap@")],
  ["HyperFrames runtime CDN script", html.includes("@hyperframes/core/dist/hyperframe.runtime.iife.js")],
];

let failed = 0;
for (const [name, pass] of checks) {
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${name}`);
  if (!pass) failed++;
}

await mkdir(".cache", { recursive: true });
const outPath = join(".cache", "smoke.html");
await writeFile(outPath, html, "utf8");
console.log(`\nWrote ${html.length} bytes of HTML to ${outPath}`);

if (failed > 0) {
  console.error(`\n${failed} check(s) failed.`);
  process.exit(1);
} else {
  console.log("\nAll smoke checks passed.");
}
