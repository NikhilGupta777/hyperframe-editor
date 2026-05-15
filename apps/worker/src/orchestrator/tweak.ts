/**
 * TWEAK loop — PLAN.md §4.3.
 *
 * Lightweight: receive the current composition + a chat instruction, ask
 * Gemini for a JSON-Patch describing minimal mutations, apply, lint, save.
 * We never re-render here; render is a separate user action.
 */
import {
  type Composition,
  CompositionSchema,
} from "@hyperframe-editor/core";
import { vertex } from "@hyperframe-editor/providers";
import { publishEvent, type QueuedJob } from "@hyperframe-editor/queue";

import { recordJobStart, recordJobFinish, persistComposition } from "./persist.js";

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

  try {
    const current = await persistComposition.load(job.projectId);
    const next = await applyTweak(current, payload.prompt);

    await persistComposition.save(job.projectId, next, /* html */ "");
    await publishEvent(job.jobId, {
      type: "done",
      url: undefined,
      gates: undefined,
    });
    await recordJobFinish(job.jobId, "succeeded", { applied: true }, null);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await publishEvent(job.jobId, { type: "error", message });
    await recordJobFinish(job.jobId, "failed", null, null, message);
    throw e;
  }
}

async function applyTweak(current: Composition, prompt: string): Promise<Composition> {
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
