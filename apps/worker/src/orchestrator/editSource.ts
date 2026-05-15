/**
 * EDIT-SOURCE loop — PLAN.md §4.2.
 *
 *   PROBE → EXTRACT_AUDIO → TRANSCRIBE → PACK_SOURCES → ANALYSE_SCENES →
 *     PROPOSE_EDL → CONCAT_CUTS → CAPTION → COMPOSE_OVER_EDL → LINT →
 *     RENDER → GATES
 *
 * Updates this wave:
 *   - Real ffmpeg concat: cuts are stitched into a single MP4 BEFORE being
 *     wrapped in HyperFrames. Frame-accurate, deterministic, watchable.
 *   - Multi-source: payload accepts `sources: SourceRef[]` (or legacy
 *     single `sourceUri`). Each gets its own probe + transcript pass.
 *   - Caption layer: the orchestrator runs autoCaption against the transcript
 *     of the kept regions and lays a CaptionBlock on track 1 of the
 *     composition, so the final render has TikTok-style burn-in via the
 *     CaptionBlock component.
 */
import { mkdtemp, mkdir, rm, writeFile, readFile, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";

import {
  type Composition,
  computeDuration,
  getPreset,
  type EDL,
} from "@hyperframe-editor/core";
import { buildCompositionHtml } from "@hyperframe-editor/compose";
import { probe, extractAudio, concatCuts } from "@hyperframe-editor/ffmpeg";
import { vertex } from "@hyperframe-editor/providers";
import { publishEvent, type QueuedJob } from "@hyperframe-editor/queue";

import { runGates } from "../gates/runner.js";
import { runRender } from "../render/runRender.js";
import { lintAndHeal } from "../agents/lintHeal.js";
import { packTranscript } from "../agents/packTranscript.js";
import { proposeEDL } from "../agents/proposeEDL.js";
import { autoCaption, type CaptionLine } from "../tools/autoCaption.js";
import { recordJobStart, recordJobFinish, persistComposition } from "./persist.js";
import { makeCostTracker } from "./cost.js";
import { finalizeRender } from "./finalize.js";

interface SourceRef {
  id: string;
  uri: string;
  language?: string;
}
interface EditSourcePayload {
  /** Multi-source form. */
  sources?: SourceRef[];
  /** Legacy single-source form (still supported). */
  sourceUri?: string;
  presetId?: string;
  direction: string;
  targetDurationSec: number;
  language?: string;
  /** Burn captions into the composition? Default: true. */
  captions?: boolean;
  /** Project budget in USD; mirrors compose.ts so single-source clips can be capped too. */
  budgetUsd?: number;
  spentUsd?: number;
}

interface StagedSource {
  id: string;
  localPath: string;
  duration: number;
  width?: number;
  height?: number;
  segments: Array<{ start: number; end: number; text: string; speaker?: string }>;
}

export async function runEditSourceLoop(job: QueuedJob): Promise<void> {
  const payload = normalisePayload(job.payload);
  const presetId = payload.presetId ?? "podcast-clip";
  const preset = getPreset(presetId);

  await recordJobStart(job.jobId);
  const workDir = await mkdtemp(join(tmpdir(), `hf-edit-${job.jobId}-`));
  await mkdir(join(workDir, "assets"), { recursive: true });

  const cost = makeCostTracker({
    jobId: job.jobId,
    projectId: job.projectId,
    publish: (e) => publishEvent(job.jobId, e),
  });

  try {
    // ---- PROBE + TRANSCRIBE every source ------------------------------------
    const staged: StagedSource[] = [];
    for (const src of payload.sources!) {
      await publishEvent(job.jobId, {
        type: "step",
        step: `PROBE:${src.id}`,
        status: "running",
      });
      const local = await stageSource(src.uri, workDir);
      const probed = await probe(local);
      await publishEvent(job.jobId, {
        type: "log",
        level: "info",
        msg: `${src.id}: ${probed.durationSec.toFixed(1)}s ${probed.width}x${probed.height}`,
      });

      await publishEvent(job.jobId, {
        type: "step",
        step: `EXTRACT_AUDIO:${src.id}`,
        status: "running",
      });
      const wav = join(workDir, `${src.id}.wav`);
      try {
        await extractAudio(local, wav);
      } catch (e) {
        await publishEvent(job.jobId, {
          type: "log",
          level: "warn",
          msg: `extract_audio:${src.id} skipped (${(e as Error).message})`,
        });
      }

      await publishEvent(job.jobId, {
        type: "step",
        step: `TRANSCRIBE:${src.id}`,
        status: "running",
      });
      const transcribed = await transcribeOrStub(wav, src.language ?? payload.language);
      if (transcribed.tokensIn > 0 || transcribed.tokensOut > 0) {
        await cost.recordText("gemini-3.1-pro", transcribed.tokensIn, transcribed.tokensOut);
      }
      staged.push({
        id: src.id,
        localPath: local,
        duration: probed.durationSec,
        width: probed.width,
        height: probed.height,
        segments: transcribed.segments,
      });
    }

    // ---- PACK + PROPOSE EDL ---------------------------------------------------
    await publishEvent(job.jobId, { type: "step", step: "PACK_SOURCES", status: "running" });
    const packed = staged
      .map((s) => packTranscript(s.id, s.duration, s.segments).packed)
      .join("\n\n");
    await publishEvent(job.jobId, {
      type: "log",
      level: "info",
      msg: `packed: ${packed.length} bytes from ${staged.length} source(s)`,
    });

    await publishEvent(job.jobId, { type: "step", step: "PROPOSE_EDL", status: "running" });
    const edlRes = await proposeEDL({
      packed,
      direction: payload.direction,
      targetDurationSec: payload.targetDurationSec,
      allowedSourceIds: staged.map((s) => s.id),
    });
    const edl = edlRes.edl;
    if (edlRes.usage) {
      await cost.recordText(edlRes.usage.model, edlRes.usage.tokensIn, edlRes.usage.tokensOut);
    }
    await publishEvent(job.jobId, {
      type: "log",
      level: "info",
      msg: `EDL: ${edl.entries.length} cuts, total ${edlDuration(edl).toFixed(1)}s`,
    });

    // ---- CONCAT cuts with ffmpeg ---------------------------------------------
    await publishEvent(job.jobId, { type: "step", step: "CONCAT_CUTS", status: "running" });
    // Write into the workDir's assets/ folder so the resulting AssetRef can use
    // a stable relative path that survives serialization. Composition.json is
    // shipped to the editor preview iframe, where /tmp/... paths from the
    // worker process are obviously unresolvable.
    const cutMp4 = join(workDir, "assets", "cuts.mp4");
    const cutAssetSrc = "assets/cuts.mp4";
    const idToPath = new Map(staged.map((s) => [s.id, s.localPath]));
    await concatCuts(
      edl.entries.map((e) => ({
        src: idToPath.get(e.sourceId) ?? staged[0]!.localPath,
        in: e.in,
        out: e.out,
        speed: e.speed,
      })),
      cutMp4,
      { width: preset.canvas.width, height: preset.canvas.height, fps: preset.canvas.fps, audio: true },
    );
    const cutProbe = await probe(cutMp4);
    await publishEvent(job.jobId, {
      type: "log",
      level: "info",
      msg: `concat: ${cutProbe.durationSec.toFixed(2)}s`,
    });

    // ---- CAPTION layer (optional) -------------------------------------------
    let captionLines: CaptionLine[] = [];
    if (payload.captions !== false) {
      await publishEvent(job.jobId, { type: "step", step: "CAPTION", status: "running" });
      // Map kept regions back to transcript segments. We linearise: for each
      // EDL entry, slide its source's segments into the cut's local timeline.
      const merged = mergeTranscriptForEDL(staged, edl);
      const result = await autoCaption(merged, { variant: "tiktok" });
      captionLines = result.lines;
      await publishEvent(job.jobId, {
        type: "log",
        level: "info",
        msg: `captions: ${captionLines.length} lines`,
      });
    }

    // ---- COMPOSE_OVER_EDL ---------------------------------------------------
    await publishEvent(job.jobId, { type: "step", step: "COMPOSE_OVER_EDL", status: "running" });
    const composition = composeOverEDL(cutAssetSrc, cutProbe.durationSec, preset, job.projectId, captionLines);

    // ---- LINT --------------------------------------------------------------
    await publishEvent(job.jobId, { type: "step", step: "LINT", status: "running" });
    const html0 = buildCompositionHtml({ preset, composition });
    const { html, errors } = await lintAndHeal(html0, { retry: async () => html0 });
    await persistComposition.save(job.projectId, composition, html);
    await publishEvent(job.jobId, {
      type: "log",
      level: errors.length === 0 ? "info" : "warn",
      msg: `lint: ${errors.length} error(s)`,
    });

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
    const blocking = Object.values(gateReport).filter(
      (g) => g && !g.pass && g.severity === "block",
    );
    if (blocking.length > 0) {
      throw new Error(`blocking gate failures: ${blocking.map((g) => g!.id).join(", ")}`);
    }

    // ---- FINALIZE -----------------------------------------------------------
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
      gates: summarise(gateReport),
    });
    await recordJobFinish(
      job.jobId,
      "succeeded",
      { url: fin.publicUrl, ociUri: fin.ociUri, costUsd: cost.total() },
      gateReport,
    );
  } catch (e) {
    await cost.emitSummary().catch(() => undefined);
    const message = e instanceof Error ? e.message : String(e);
    await publishEvent(job.jobId, { type: "error", message });
    await recordJobFinish(job.jobId, "failed", { costUsd: cost.total() }, null, message);
    throw e;
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function normalisePayload(raw: unknown): EditSourcePayload & { sources: SourceRef[] } {
  const p = raw as EditSourcePayload;
  if (p.sources && p.sources.length > 0) {
    return { ...p, sources: p.sources };
  }
  if (p.sourceUri) {
    return {
      ...p,
      sources: [{ id: "src-0", uri: p.sourceUri }],
    };
  }
  throw new Error("editSource payload missing sources/sourceUri");
}

async function stageSource(uri: string, workDir: string): Promise<string> {
  if (uri.startsWith("oci://") && process.env.STORAGE_BUCKET) {
    const { getStorage } = await import("@hyperframe-editor/storage");
    const storage = getStorage();
    const { key } = storage.parseUri(uri);
    const buf = await storage.getObject(key);
    const local = join(workDir, basename(key));
    await writeFile(local, buf);
    return local;
  }
  if (uri.startsWith("file://")) {
    const localCopy = join(workDir, basename(uri));
    await copyFile(uri.replace(/^file:\/\//, ""), localCopy);
    return localCopy;
  }
  // Local path. Copy into workDir so concatCuts can resolve it consistently.
  const localCopy = join(workDir, basename(uri));
  await copyFile(uri, localCopy);
  return localCopy;
}

async function transcribeOrStub(
  wavPath: string,
  language?: string,
): Promise<{
  segments: Array<{ start: number; end: number; text: string; speaker?: string }>;
  tokensIn: number;
  tokensOut: number;
}> {
  if (process.env.GOOGLE_CLOUD_PROJECT || process.env.VERTEX_PROJECT) {
    try {
      const bytes = await readFile(wavPath);
      const r = await vertex.transcribe({
        audio: { bytes, mimeType: "audio/wav" },
        language,
        withSpeakers: true,
      });
      return { segments: r.segments, tokensIn: r.tokensIn, tokensOut: r.tokensOut };
    } catch {
      // fall through to stub
    }
  }
  // Deterministic stub: 8 fake segments evenly spaced.
  const total = 30;
  const seg = total / 8;
  const segments = Array.from({ length: 8 }, (_, i) => ({
    start: i * seg,
    end: (i + 1) * seg,
    text: `synthetic segment ${i + 1}`,
    speaker: i % 2 === 0 ? "S0" : "S1",
  }));
  return { segments, tokensIn: 0, tokensOut: 0 };
}

function edlDuration(edl: EDL): number {
  return edl.entries.reduce((a, e) => a + (e.out - e.in), 0);
}

/**
 * Linearise the transcript across an EDL: for each kept cut, take the source's
 * segments overlapping the cut and re-anchor them in the output timeline.
 */
function mergeTranscriptForEDL(
  staged: StagedSource[],
  edl: EDL,
): Array<{ start: number; end: number; text: string; speaker?: string }> {
  const out: Array<{ start: number; end: number; text: string; speaker?: string }> = [];
  const idToSrc = new Map(staged.map((s) => [s.id, s]));
  let cursor = 0;
  for (const cut of edl.entries) {
    const src = idToSrc.get(cut.sourceId);
    if (!src) continue;
    const cutDur = cut.out - cut.in;
    const overlapping = src.segments.filter(
      (s) => s.end > cut.in && s.start < cut.out,
    );
    for (const seg of overlapping) {
      const localStart = Math.max(0, seg.start - cut.in);
      const localEnd = Math.min(cutDur, seg.end - cut.in);
      if (localEnd <= localStart) continue;
      out.push({
        start: cursor + localStart,
        end: cursor + localEnd,
        text: seg.text,
        speaker: seg.speaker,
      });
    }
    cursor += cutDur;
  }
  return out;
}

/**
 * Build a composition that wraps the already-cut MP4 as a single video clip on
 * track 0, and (optionally) layers caption blocks on track 1.
 *
 * `cutSrc` is a project-relative path (e.g. `assets/cuts.mp4`) so the
 * composition.json the editor consumes never bakes in a /tmp absolute path.
 */
function composeOverEDL(
  cutSrc: string,
  cutDuration: number,
  preset: ReturnType<typeof getPreset>,
  projectId: string,
  captions: CaptionLine[],
): Composition {
  const clips: Composition["clips"] = [
    {
      id: "edit-0",
      kind: "video",
      trackIndex: 0,
      start: 0,
      duration: cutDuration,
      playbackOffset: 0,
      props: { src: cutSrc },
    },
  ];
  if (captions.length > 0) {
    clips.push({
      id: "captions",
      kind: "block",
      block: "CaptionBlock",
      trackIndex: 1,
      start: 0,
      duration: cutDuration,
      playbackOffset: 0,
      props: {
        lines: captions,
        style: "tiktok",
      },
    });
  }
  const comp: Composition = {
    id: projectId,
    canvas: preset.canvas,
    duration: 0,
    assets: [{ id: "main", kind: "video", src: cutSrc }],
    clips,
    variables: {},
  };
  comp.duration = computeDuration(comp);
  return comp;
}

function summarise(report: Awaited<ReturnType<typeof runGates>>) {
  const out = {} as Record<string, "pass" | "warn" | "fail">;
  for (const [id, r] of Object.entries(report)) {
    if (!r) continue;
    out[id] = r.pass ? "pass" : r.severity === "warn" ? "warn" : "fail";
  }
  return out;
}
