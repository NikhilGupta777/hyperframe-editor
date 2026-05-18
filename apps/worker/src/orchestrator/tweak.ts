/**
 * TWEAK loop — PLAN.md §4.3.
 *
 * Lightweight: receive the current composition + a chat instruction, ask
 * Gemini for the mutated AST, apply, lint, save BOTH the AST and the rebuilt
 * HTML. We never re-render here; render is a separate user action.
 *
 * Why we rebuild HTML:
 *   The composition has two on-disk forms — composition.json (AST, source of
 *   truth) and composition.html (preview iframe + render input). If we only
 *   updated the AST after a tweak, the iframe would stay stale until the next
 *   full Render, breaking the preview-after-tweak experience. So every
 *   successful tweak ends with `buildCompositionHtml(...)` and a save of both.
 *
 * Cost ledger:
 *   When Vertex is configured, the JSON-Patch call charges its tokens through
 *   the shared CostTracker so the editor's running total stays accurate.
 */
import {
  type Composition,
  CompositionSchema,
} from "@hyperframe-editor/core";
import { buildCompositionHtml } from "@hyperframe-editor/compose";
import { vertex } from "@hyperframe-editor/providers";
import { publishEvent, type QueuedJob } from "@hyperframe-editor/queue";

import {
  recordJobStart,
  recordJobFinish,
  persistComposition,
  loadProjectPreset,
} from "./persist.js";
import { makeCostTracker, type CostTracker } from "./cost.js";

interface TweakPayload {
  prompt: string;
}

const PATCH_SCHEMA = {
  type: "object",
  required: ["composition"],
  properties: {
    composition: { type: "object" },
  },
};

export async function runTweakLoop(job: QueuedJob): Promise<void> {
  const payload = job.payload as unknown as TweakPayload;
  await recordJobStart(job.jobId);
  await publishEvent(job.jobId, { type: "step", step: "TWEAK", status: "running" });

  const cost = makeCostTracker({
    jobId: job.jobId,
    projectId: job.projectId,
    publish: (e) => publishEvent(job.jobId, e),
  });

  try {
    const current = await persistComposition.load(job.projectId);
    const preset = await loadProjectPreset(job.projectId);
    const next = await applyTweak(current, payload.prompt, cost);

    // Rebuild HTML from the new AST so the preview iframe served by
    // /api/projects/:id/composition is fresh after this tweak. Without this,
    // the AST and HTML drift until the next full render.
    const html = buildCompositionHtml({ preset, composition: next });

    await persistComposition.save(job.projectId, next, html);

    await cost.emitSummary();
    await publishEvent(job.jobId, {
      type: "done",
      url: undefined,
      gates: undefined,
    });
    await recordJobFinish(
      job.jobId,
      "succeeded",
      { applied: true, costUsd: cost.total() },
      null,
    );
  } catch (e) {
    await cost.emitSummary().catch(() => undefined);
    const message = e instanceof Error ? e.message : String(e);
    await publishEvent(job.jobId, { type: "error", message });
    await recordJobFinish(job.jobId, "failed", { costUsd: cost.total() }, null, message);
    throw e;
  }
}

async function applyTweak(
  current: Composition,
  prompt: string,
  cost: CostTracker,
): Promise<Composition> {
  // Offline stub: tiny heuristic on plain prompt strings so the loop runs
  // end-to-end without Vertex. Phase 2 swaps this for proper JSON-Patch.
  if (!process.env.GOOGLE_CLOUD_PROJECT && !process.env.VERTEX_PROJECT) {
    return localTweak(current, prompt);
  }

  const system = `You receive a HyperFrames composition AST as JSON and an instruction. Return the FULL composition AST after applying the instruction, as STRICT JSON. Make the smallest change possible. Do not rewrite unrelated clips. Output JSON only.`;
  const userMsg = JSON.stringify({ instruction: prompt, composition: current });

  const r = await vertex.generateText({
    model: "reasoning",
    system,
    messages: [{ role: "user", content: userMsg }],
    temperature: 0.2,
    jsonSchema: PATCH_SCHEMA,
  });
  await cost.recordText("gemini-3.1-pro-preview", r.tokensIn, r.tokensOut);
  const parsed = (r.parsed ?? JSON.parse(r.text)) as { composition: unknown };
  return CompositionSchema.parse(parsed.composition);
}

function localTweak(c: Composition, prompt: string): Composition {
  const next: Composition = JSON.parse(JSON.stringify(c));
  // tiny grammar: "make the title bigger" / "longer" / "shorter"
  if (/title.*bigger|larger/i.test(prompt)) {
    for (const clip of next.clips) {
      if (clip.block === "HookTitle") {
        const props = clip.props as { fontScale?: number };
        props.fontScale = (props.fontScale ?? 1) * 1.15;
      }
    }
  }
  if (/longer/i.test(prompt) && next.clips.length > 0) {
    const last = next.clips[next.clips.length - 1]!;
    last.duration += 1;
    next.duration += 1;
  }
  if (/shorter/i.test(prompt) && next.clips.length > 0) {
    const last = next.clips[next.clips.length - 1]!;
    last.duration = Math.max(0.5, last.duration - 1);
    next.duration = Math.max(0.5, next.duration - 1);
  }
  return next;
}
