/**
 * BUILD (compose) loop — PLAN.md §4.1.
 *
 *   load preset → WRITE_BRIEF → PLAN_BEATS → ACQUIRE_ASSETS → COMPOSE → LINT
 *     → PREFLIGHT → RENDER → run all 8 gates → mark job succeeded
 *
 * Cost ledger:
 *   - Every Vertex call (writeBrief, planBeats) records its tokensIn/tokensOut
 *     under provider 'vertex-gemini-3.1-pro'.
 *   - Every paid image-gen call records under 'vertex-imagen-4.0-fast-generate-001'.
 *   - Render charges priceRender(composition.duration) under 'oracle-render'.
 *   - Each entry is persisted to cost_events (when DATABASE_URL is set) AND
 *     emitted as a `tool` SSE event so the editor's top-bar can show running
 *     totals live. A final `costSummary` event tells the UI to refresh the
 *     persisted total once the job is done.
 */
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  type Composition,
  computeDuration,
  getPreset,
  type Beat,
  type AssetRef,
} from "@hyperframe-editor/core";
import { buildCompositionHtml } from "@hyperframe-editor/compose";
import { publishEvent, type QueuedJob } from "@hyperframe-editor/queue";

import { lintAndHeal } from "../agents/lintHeal.js";
import { writeBrief } from "../agents/writeBrief.js";
import { planBeats } from "../agents/planBeats.js";
import { acquireAssets, type AcquiredAsset } from "../agents/acquireAssets.js";
import { runRender } from "../render/runRender.js";
import { runGates } from "../gates/runner.js";
import { recordJobStart, recordJobFinish, persistComposition } from "./persist.js";
import { preflight } from "./preflight.js";
import { makeCostTracker } from "./cost.js";

interface ComposeJobPayload {
  prompt: string;
  presetId?: string;
  /** If true, skip planning + brief; render the existing composition snapshot. */
  renderOnly?: boolean;
  /** Project budget in USD; the orchestrator refuses runs that would overshoot. */
  budgetUsd?: number;
  spentUsd?: number;
  /** When true, never call paid image-gen even if Vertex is configured. */
  freeOnly?: boolean;
}

export async function runComposeLoop(job: QueuedJob): Promise<void> {
  const payload = job.payload as unknown as ComposeJobPayload;
  const presetId = payload.presetId ?? "tiktok-hook";
  const preset = getPreset(presetId);

  await recordJobStart(job.jobId);
  await publishEvent(job.jobId, { type: "step", step: "START", status: "running" });

  const workDir = await mkdtemp(join(tmpdir(), `hf-${job.jobId}-`));
  await mkdir(join(workDir, "assets"), { recursive: true });

  const cost = makeCostTracker({
    jobId: job.jobId,
    projectId: job.projectId,
    publish: (e) => publishEvent(job.jobId, e),
  });

  try {
    let composition: Composition;

    if (payload.renderOnly) {
      composition = await persistComposition.load(job.projectId);
    } else {
      // ---- WRITE_BRIEF ------------------------------------------------------
      await publishEvent(job.jobId, { type: "step", step: "WRITE_BRIEF", status: "running" });
      const briefRes = await writeBrief({ prompt: payload.prompt, preset });
      const brief = briefRes.brief;
      if (briefRes.usage) {
        await cost.recordText(briefRes.usage.model, briefRes.usage.tokensIn, briefRes.usage.tokensOut);
      }
      await publishEvent(job.jobId, {
        type: "log",
        level: "info",
        msg: `brief: ${brief.title}`,
      });

      // ---- PLAN_BEATS -------------------------------------------------------
      await publishEvent(job.jobId, { type: "step", step: "PLAN_BEATS", status: "running" });
      const planRes = await planBeats({ brief, preset });
      const beats: Beat[] = planRes.beats;
      if (planRes.usage) {
        await cost.recordText(planRes.usage.model, planRes.usage.tokensIn, planRes.usage.tokensOut);
      }
      await publishEvent(job.jobId, {
        type: "log",
        level: "info",
        msg: `plan: ${beats.length} beats, ${beats.reduce((a, b) => a + b.duration, 0).toFixed(1)}s`,
      });

      // ---- ACQUIRE_ASSETS ---------------------------------------------------
      await publishEvent(job.jobId, {
        type: "step",
        step: "ACQUIRE_ASSETS",
        status: "running",
      });
      const acquired = await acquireAssets({
        beats,
        workDir,
        aspectRatio: preset.canvas.height >= preset.canvas.width ? "9:16" : "16:9",
        freeOnly: payload.freeOnly,
        publish: async (msg) =>
          publishEvent(job.jobId, { type: "log", level: "info", msg }),
      });
      if (acquired.generatedImagesByModel.fast > 0) {
        await cost.recordImage(
          "imagen-4.0-fast-generate-001",
          acquired.generatedImagesByModel.fast,
        );
      }
      if (acquired.generatedImagesByModel.hq > 0) {
        await cost.recordImage("gemini-3-pro-image", acquired.generatedImagesByModel.hq);
      }
      await publishEvent(job.jobId, {
        type: "log",
        level: "info",
        msg: `acquired ${acquired.assets.length} asset(s)`,
      });
      for (const a of acquired.assets) {
        await publishEvent(job.jobId, {
          type: "tool",
          name: "asset",
          output: {
            beatId: a.beatId,
            slot: a.slot,
            kind: a.asset.kind,
            provider: a.asset.attribution?.provider,
            src: a.asset.src,
            generated: a.generated ?? false,
          },
        });
      }

      // ---- COMPOSE ----------------------------------------------------------
      await publishEvent(job.jobId, { type: "step", step: "COMPOSE", status: "running" });
      composition = beatsToComposition(beats, preset, job.projectId, acquired.assets);

      // ---- LINT (self-heal) -------------------------------------------------
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

    // ---- PREFLIGHT --------------------------------------------------------
    await publishEvent(job.jobId, { type: "step", step: "PREFLIGHT", status: "running" });
    try {
      const pre = await preflight({
        composition,
        preset,
        budgetUsd: payload.budgetUsd ?? 1.0,
        spentUsd: (payload.spentUsd ?? 0) + cost.total(),
      });
      await publishEvent(job.jobId, {
        type: "log",
        level: "info",
        msg: `preflight: dry=${pre.dryMs}ms, est $${pre.estimateUsd.toFixed(4)}, remaining $${pre.remainingUsd.toFixed(4)}`,
      });
    } catch (e) {
      await publishEvent(job.jobId, {
        type: "log",
        level: "warn",
        msg: `preflight: ${(e as Error).message}`,
      });
    }

    // ---- RENDER + GATES ----------------------------------------------------
    await publishEvent(job.jobId, { type: "step", step: "RENDER", status: "running" });
    const renderRes = await runRender({
      projectId: job.projectId,
      composition,
      preset,
      workDir,
      onProgress: (pct, frame, total) =>
        publishEvent(job.jobId, { type: "progress", pct, frame, total }),
    });
    await cost.recordRender(composition.duration);

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

    await cost.emitSummary();
    await publishEvent(job.jobId, {
      type: "done",
      url: renderRes.publicUrl,
      gates: summary as Record<string, "pass" | "warn" | "fail">,
    });
    await recordJobFinish(
      job.jobId,
      "succeeded",
      { url: renderRes.publicUrl, costUsd: cost.total() },
      gateReport,
    );
  } catch (e) {
    // Best-effort summary emit even on failure so the UI's running total reflects
    // partial spend (e.g. brief tokens consumed before a render failure).
    await cost.emitSummary().catch(() => undefined);
    const message = e instanceof Error ? e.message : String(e);
    await publishEvent(job.jobId, { type: "error", message });
    await recordJobFinish(job.jobId, "failed", { costUsd: cost.total() }, null, message);
    throw e;
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

function beatsToComposition(
  beats: Beat[],
  preset: ReturnType<typeof getPreset>,
  projectId: string,
  acquired: AcquiredAsset[],
): Composition {
  const clips: Composition["clips"] = [];
  const assets: AssetRef[] = [];
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

    // Layer any acquired assets for this beat as a KenBurnsImage on track 1,
    // sized to the beat. Image-only for MVP; video B-rolls land in Phase 2.
    const beatAssets = acquired.filter((a) => a.beatId === b.id);
    for (const a of beatAssets) {
      if (a.asset.kind !== "image") continue;
      assets.push(a.asset);
      clips.push({
        id: `${b.id}-bg-${assets.length}`,
        kind: "block",
        block: "KenBurnsImage",
        trackIndex: 1,
        start: Number(t.toFixed(3)),
        duration: Number(b.duration.toFixed(3)),
        playbackOffset: 0,
        props: { src: a.asset.src, direction: "in" },
      });
    }
    t += b.duration;
  }
  const composition: Composition = {
    id: projectId,
    canvas: preset.canvas,
    duration: 0,
    assets,
    clips,
    variables: {},
  };
  composition.duration = computeDuration(composition);
  return composition;
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
