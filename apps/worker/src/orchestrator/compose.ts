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

import { writeBrief } from "../agents/writeBrief.js";
import { planBeats } from "../agents/planBeats.js";
import { acquireAssets, type AcquiredAsset } from "../agents/acquireAssets.js";
import { runRender } from "../render/runRender.js";
import { runGates } from "../gates/runner.js";
import { recordJobStart, recordJobFinish, persistComposition } from "./persist.js";
import { preflight } from "./preflight.js";
import { makeCostTracker } from "./cost.js";
import { finalizeRender } from "./finalize.js";

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
  const presetId = payload.presetId ?? "youtube-essay";
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
        await cost.recordImage("gemini-3-pro-image-preview", acquired.generatedImagesByModel.hq);
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

      // Use Gemini to generate a full HyperFrames HTML composition directly.
      // This produces far richer output than the block-based builder: real video
      // clips, GSAP animations, transitions, kinetic typography, etc.
      const { composeHtml } = await import("../agents/composeHtml.js");
      const composeRes = await composeHtml({
        projectId: job.projectId,
        brief: { title: brief.title, summary: brief.summary, mandates: brief.mandates },
        beats,
        assets: acquired.assets.map((a) => ({ beatId: a.beatId, slot: a.slot, asset: a.asset })),
        preset,
      });
      await cost.recordText("gemini-3.1-pro-preview", composeRes.tokensIn, composeRes.tokensOut);

      let html = composeRes.html;

      // Run the portable lint to catch structural issues
      const { lintHtml } = await import("../agents/lintHeal.js");
      const lintErrors = lintHtml(html);
      await publishEvent(job.jobId, {
        type: "log",
        level: lintErrors.length === 0 ? "info" : "warn",
        msg: `lint pass: errors=${lintErrors.length}`,
      });

      // If lint found critical issues, fall back to the block-based builder
      if (lintErrors.some((e) => e.rule === "doctype" || e.rule === "timeline_paused" || e.rule === "timeline_registered")) {
        await publishEvent(job.jobId, {
          type: "log",
          level: "warn",
          msg: "AI composition had structural issues, falling back to block builder",
        });
        const { buildCompositionHtml } = await import("@hyperframe-editor/compose");
        html = buildCompositionHtml({ preset, composition });
      }

      await persistComposition.save(job.projectId, composition, html);
    }

    // ---- PREFLIGHT --------------------------------------------------------
    // Two failure modes here:
    //   * dryRender failed (composition won't build) — fatal, abort the run.
    //   * budget would exceed cap — also fatal; we can't proceed in good
    //     conscience after the user explicitly capped spend. Soft-fail
    //     behaviour was hiding overspend bugs in earlier waves.
    // Either way we surface the reason to the SSE stream first so the editor
    // shows an explanation instead of a blank "error" toast.
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
      const message = (e as Error).message;
      await publishEvent(job.jobId, {
        type: "log",
        level: "error",
        msg: `preflight: ${message}`,
      });
      throw new Error(`preflight failed: ${message}`);
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

    // ---- FINALIZE: upload artifacts + mint a viewable URL -----------------
    // Only runs after gates pass. We want a green render to land in OCI; a
    // blocked render leaves the workDir alone for post-mortem inspection
    // before the orchestrator's `rm` cleanup.
    await publishEvent(job.jobId, { type: "step", step: "FINALIZE", status: "running" });
    const fin = await finalizeRender({
      projectId: job.projectId,
      jobId: job.jobId,
      workDir,
      mp4Path: renderRes.mp4Path,
      htmlPath: renderRes.htmlPath,
      composition,
    });
    await publishEvent(job.jobId, {
      type: "log",
      level: "info",
      msg: fin.ociUri
        ? `finalize: uploaded ${fin.assetsUploaded} asset(s) + mp4 (${(fin.bytesUploaded / 1e6).toFixed(1)} MB)`
        : `finalize: skipped (STORAGE_BUCKET unset; using ${fin.publicUrl})`,
    });

    await cost.emitSummary();
    await publishEvent(job.jobId, {
      type: "done",
      url: fin.publicUrl,
      gates: summary as Record<string, "pass" | "warn" | "fail">,
    });
    await recordJobFinish(
      job.jobId,
      "succeeded",
      { url: fin.publicUrl, ociUri: fin.ociUri, costUsd: cost.total() },
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
    const beatAssets = acquired.filter((a) => a.beatId === b.id);
    const imageAssets = beatAssets.filter((a) => a.asset.kind === "image");
    const videoAssets = beatAssets.filter((a) => a.asset.kind === "video");

    // Track 0: Background layer — KenBurns image or first available asset
    const bgAsset = imageAssets[0] ?? videoAssets[0];
    if (bgAsset) {
      assets.push(bgAsset.asset);
      if (bgAsset.asset.kind === "image") {
        clips.push({
          id: `${b.id}-bg-${i}`,
          kind: "block",
          block: "KenBurnsImage",
          trackIndex: 0,
          start: Number(t.toFixed(3)),
          duration: Number(b.duration.toFixed(3)),
          playbackOffset: 0,
          props: { src: bgAsset.asset.src, direction: i % 2 === 0 ? "in" : "out" },
        });
      } else {
        clips.push({
          id: `${b.id}-bg-${i}`,
          kind: "block",
          block: "BRollWindow",
          trackIndex: 0,
          start: Number(t.toFixed(3)),
          duration: Number(b.duration.toFixed(3)),
          playbackOffset: 0,
          props: { src: bgAsset.asset.src, corner: "center", width: 1.0 },
        });
      }
    }

    // Track 1: Primary text/content block — the main block for this beat
    const primaryBlock = b.blocks[0] ?? "HookTitle";
    clips.push({
      id: `${b.id}-main-${i}`,
      kind: "block",
      block: primaryBlock,
      trackIndex: 1,
      start: Number(t.toFixed(3)),
      duration: Number(b.duration.toFixed(3)),
      playbackOffset: 0,
      props: propsForBlock(primaryBlock, b),
    });

    // Track 2: Secondary blocks (overlays) — use remaining blocks from the beat
    for (let bi = 1; bi < b.blocks.length && bi <= 2; bi++) {
      const overlayBlock = b.blocks[bi]!;
      // Skip blocks that need assets if we don't have them
      if ((overlayBlock === "KenBurnsImage" || overlayBlock === "BRollWindow") && !imageAssets[bi]) {
        continue;
      }
      clips.push({
        id: `${b.id}-overlay-${bi}-${i}`,
        kind: "block",
        block: overlayBlock,
        trackIndex: 1 + bi,
        start: Number(t.toFixed(3)),
        duration: Number(b.duration.toFixed(3)),
        playbackOffset: 0,
        props: propsForBlock(overlayBlock, b),
      });
    }

    // Track 3: B-roll video window (picture-in-picture) if we have video assets
    if (videoAssets.length > 0 && primaryBlock !== "BRollWindow") {
      const vid = videoAssets[0]!;
      assets.push(vid.asset);
      clips.push({
        id: `${b.id}-broll-${i}`,
        kind: "block",
        block: "BRollWindow",
        trackIndex: 3,
        start: Number((t + b.duration * 0.1).toFixed(3)),
        duration: Number((b.duration * 0.7).toFixed(3)),
        playbackOffset: 0,
        props: { src: vid.asset.src, corner: "br", width: 0.36 },
      });
    }

    // Track 4: Additional image assets as secondary KenBurns (split the beat)
    if (imageAssets.length > 1) {
      const secondImg = imageAssets[1]!;
      assets.push(secondImg.asset);
      const halfDur = b.duration / 2;
      clips.push({
        id: `${b.id}-img2-${i}`,
        kind: "block",
        block: "KenBurnsImage",
        trackIndex: 0,
        start: Number((t + halfDur).toFixed(3)),
        duration: Number(halfDur.toFixed(3)),
        playbackOffset: 0,
        props: { src: secondImg.asset.src, direction: "out" },
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
      return { text: narration || "Hook", subtext: "" };
    case "EndCard":
      return { cta: narration || "Subscribe" };
    case "KineticHeadline":
      return {
        words: (narration || beat.id).split(/\s+/).filter(Boolean).slice(0, 8),
      };
    case "QuoteCard":
      return { quote: narration || "—", attribution: "" };
    case "LowerThird":
      return { name: narration || "Speaker", title: "" };
    case "LogoBug":
      return { handle: "@hyperframeeditor" };
    case "CaptionBlock":
      return { lines: [], style: "tiktok" };
    case "KenBurnsImage":
      return { src: "", direction: "in" };
    case "BRollWindow":
      return { src: "" };
    case "SplitScreen":
      return { left: "", right: "" };
    default:
      return {};
  }
}
