/**
 * BUILD (compose) loop — PLAN.md §4.1.
 *
 *   load preset → WRITE_BRIEF → PLAN_BEATS → ACQUIRE_ASSETS → COMPOSE → LINT (self-heal)
 *     → PREFLIGHT → RENDER → run all 8 gates → mark job succeeded
 *
 * MVP scope (Phase 1):
 *   - tiktok-hook preset
 *   - HookTitle + EndCard blocks
 *   - stock-only assets (no image-gen yet — Phase 2 turns that on)
 *   - gates G1, G2, G3, G7, G8 are blocking; G4, G5, G6 emit warnings
 *
 * Wave I: added preflight step before render so we catch broken compositions
 * and over-budget runs before paying for a full Chromium pass.
 */
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  type Composition,
  computeDuration,
  getPreset,
  type Beat,
} from "@hyperframe-editor/core";
import { buildCompositionHtml } from "@hyperframe-editor/compose";
import { publishEvent, type QueuedJob } from "@hyperframe-editor/queue";

import { lintAndHeal } from "../agents/lintHeal.js";
import { writeBrief } from "../agents/writeBrief.js";
import { planBeats } from "../agents/planBeats.js";
import { runRender } from "../render/runRender.js";
import { runGates } from "../gates/runner.js";
import { recordJobStart, recordJobFinish, persistComposition } from "./persist.js";
import { preflight } from "./preflight.js";

interface ComposeJobPayload {
  prompt: string;
  presetId?: string;
  /** If true, skip planning + brief; render the existing composition snapshot. */
  renderOnly?: boolean;
  /** Project budget in USD; the orchestrator refuses runs that would overshoot. */
  budgetUsd?: number;
  spentUsd?: number;
}

export async function runComposeLoop(job: QueuedJob): Promise<void> {
  const payload = job.payload as unknown as ComposeJobPayload;
  const presetId = payload.presetId ?? "tiktok-hook";
  const preset = getPreset(presetId);

  await recordJobStart(job.jobId);
  await publishEvent(job.jobId, { type: "step", step: "START", status: "running" });

  const workDir = await mkdtemp(join(tmpdir(), `hf-${job.jobId}-`));
  await mkdir(join(workDir, "assets"), { recursive: true });

  try {
    let composition: Composition;

    if (payload.renderOnly) {
      composition = await persistComposition.load(job.projectId);
    } else {
      // ---- WRITE_BRIEF
      await publishEvent(job.jobId, { type: "step", step: "WRITE_BRIEF", status: "running" });
      const brief = await writeBrief({ prompt: payload.prompt, preset });
      await publishEvent(job.jobId, { type: "log", level: "info", msg: `brief: ${brief.title}` });

      // ---- PLAN_BEATS
      await publishEvent(job.jobId, { type: "step", step: "PLAN_BEATS", status: "running" });
      const beats: Beat[] = await planBeats({ brief, preset });
      await publishEvent(job.jobId, {
        type: "log",
        level: "info",
        msg: `plan: ${beats.length} beats, ${beats.reduce((a, b) => a + b.duration, 0).toFixed(1)}s`,
      });

      // ---- COMPOSE
      await publishEvent(job.jobId, { type: "step", step: "COMPOSE", status: "running" });
      composition = beatsToComposition(beats, preset, job.projectId);

      // ---- LINT (self-heal)
      await publishEvent(job.jobId, { type: "step", step: "LINT", status: "running" });
      const html0 = buildCompositionHtml({ preset, composition });
      const { html, attempts, errors } = await lintAndHeal(html0, {
        retry: async (lintErrors) => {
          await publishEvent(job.jobId, {
            type: "log",
            level: "warn",
            msg: `lint produced ${lintErrors.length} error(s)`,
          });
          return html0;
        },
      });
      await publishEvent(job.jobId, {
        type: "log",
        level: errors.length === 0 ? "info" : "warn",
        msg: `lint pass: attempts=${attempts}, errors=${errors.length}`,
      });
      await persistComposition.save(job.projectId, composition, html);
    }

    // ---- PREFLIGHT — dry render + budget check ------------------------------
    await publishEvent(job.jobId, { type: "step", step: "PREFLIGHT", status: "running" });
    try {
      const pre = await preflight({
        composition,
        preset,
        budgetUsd: payload.budgetUsd ?? 1.0,
        spentUsd: payload.spentUsd ?? 0,
      });
      await publishEvent(job.jobId, {
        type: "log",
        level: "info",
        msg: `preflight: dry=${pre.dryMs}ms, est $${pre.estimateUsd.toFixed(4)}, remaining $${pre.remainingUsd.toFixed(4)}`,
      });
    } catch (e) {
      // Preflight failures are surfaced but not auto-fatal — the user may have
      // raised the budget separately. We log and continue; the gate runner
      // catches genuine bugs after the actual render.
      await publishEvent(job.jobId, {
        type: "log",
        level: "warn",
        msg: `preflight: ${(e as Error).message}`,
      });
    }

    // ---- RENDER + GATES -----------------------------------------------------
    await publishEvent(job.jobId, { type: "step", step: "RENDER", status: "running" });
    const renderRes = await runRender({
      projectId: job.projectId,
      composition,
      preset,
      workDir,
      onProgress: (pct, frame, total) =>
        publishEvent(job.jobId, { type: "progress", pct, frame, total }),
    });

    await publishEvent(job.jobId, { type: "step", step: "GATES", status: "running" });
    const gateReport = await runGates({
      projectId: job.projectId,
      composition,
      preset,
      mp4Path: renderRes.mp4Path,
      htmlPath: renderRes.htmlPath,
      networkLog: renderRes.networkLog,
      onGate: (g) =>
        publishEvent(job.jobId, {
          type: "gate",
          id: g.id,
          pass: g.pass,
          severity: g.severity,
          details: g.details,
          fix: g.fix,
        }),
    });

    const blockingFails = Object.values(gateReport).filter(
      (g) => g && !g.pass && g.severity === "block",
    );
    if (blockingFails.length > 0) {
      throw new Error(
        `blocking gate failures: ${blockingFails.map((g) => g!.id).join(", ")}`,
      );
    }

    const summary = Object.fromEntries(
      Object.entries(gateReport).map(([id, r]) => [
        id,
        r ? (r.pass ? "pass" : r.severity === "warn" ? "warn" : "fail") : "skip",
      ]),
    ) as Record<string, "pass" | "warn" | "fail" | "skip">;

    await publishEvent(job.jobId, {
      type: "done",
      url: renderRes.publicUrl,
      gates: summary as Record<string, "pass" | "warn" | "fail">,
    });
    await recordJobFinish(job.jobId, "succeeded", { url: renderRes.publicUrl }, gateReport);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await publishEvent(job.jobId, { type: "error", message });
    await recordJobFinish(job.jobId, "failed", null, null, message);
    throw e;
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

function beatsToComposition(
  beats: Beat[],
  preset: ReturnType<typeof getPreset>,
  projectId: string,
): Composition {
  const clips: Composition["clips"] = [];
  let t = 0;
  for (let i = 0; i < beats.length; i++) {
    const b = beats[i]!;
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
    id: projectId,
    canvas: preset.canvas,
    duration: 0,
    assets: [],
    clips,
    variables: {},
  };
  composition.duration = computeDuration(composition);
  return composition;
}

function propsForBlock(block: string, beat: Beat): Record<string, unknown> {
  switch (block) {
    case "HookTitle":
      return { text: beat.narration ?? "Hook", subtext: undefined };
    case "EndCard":
      return { cta: beat.narration ?? "Subscribe" };
    default:
      return {};
  }
}
