/**
 * EDIT-SOURCE loop — PLAN.md §4.2.
 *
 *   PROBE → EXTRACT_AUDIO → TRANSCRIBE → PACK_SOURCES → ANALYSE_SCENES →
 *     PROPOSE_EDL → COMPOSE_OVER_EDL → LINT → RENDER → GATES
 *
 * MVP scope:
 *   - one source (extends to N in Phase 2)
 *   - no fetch-broll layering (Phase 2)
 *   - same gate set as compose loop (G1-G8)
 *
 * The loop tolerates missing Vertex / Postgres / OCI by falling back to
 * deterministic stubs so the editor still demonstrates the flow on a vanilla
 * preview deploy.
 */
import { mkdtemp, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  type Composition,
  computeDuration,
  getPreset,
  type EDL,
} from "@hyperframe-editor/core";
import { buildCompositionHtml } from "@hyperframe-editor/compose";
import { probe, extractAudio } from "@hyperframe-editor/ffmpeg";
import { vertex } from "@hyperframe-editor/providers";
import { publishEvent, type QueuedJob } from "@hyperframe-editor/queue";

import { runGates } from "../gates/runner.js";
import { runRender } from "../render/runRender.js";
import { lintAndHeal } from "./../agents/lintHeal.js";
import { packTranscript } from "../agents/packTranscript.js";
import { proposeEDL } from "../agents/proposeEDL.js";
import { recordJobStart, recordJobFinish, persistComposition } from "./persist.js";

interface EditSourcePayload {
  /** Local-disk path or oci:// URI of the primary source video. */
  sourceUri: string;
  presetId?: string;
  direction: string;
  targetDurationSec: number;
  /** Optional language hint for transcription (e.g. "en", "hi"). */
  language?: string;
}

export async function runEditSourceLoop(job: QueuedJob): Promise<void> {
  const payload = job.payload as unknown as EditSourcePayload;
  const presetId = payload.presetId ?? "podcast-clip";
  const preset = getPreset(presetId);

  await recordJobStart(job.jobId);
  const workDir = await mkdtemp(join(tmpdir(), `hf-edit-${job.jobId}-`));
  await mkdir(join(workDir, "assets"), { recursive: true });

  try {
    await publishEvent(job.jobId, { type: "step", step: "PROBE", status: "running" });
    const sourceLocal = await stageSource(payload.sourceUri, workDir);
    const probed = await probe(sourceLocal);
    await publishEvent(job.jobId, {
      type: "log",
      level: "info",
      msg: `probe: ${probed.durationSec.toFixed(1)}s ${probed.width}x${probed.height} ${probed.videoCodec ?? "?"}`,
    });

    await publishEvent(job.jobId, { type: "step", step: "EXTRACT_AUDIO", status: "running" });
    const wavPath = join(workDir, "audio.wav");
    await extractAudio(sourceLocal, wavPath);

    await publishEvent(job.jobId, { type: "step", step: "TRANSCRIBE", status: "running" });
    const segments = await transcribeOrStub(wavPath, payload.language);
    await publishEvent(job.jobId, {
      type: "log",
      level: "info",
      msg: `transcribe: ${segments.length} segments`,
    });

    await publishEvent(job.jobId, { type: "step", step: "PACK_SOURCES", status: "running" });
    const { packed } = packTranscript("src-0", probed.durationSec, segments);
    await publishEvent(job.jobId, { type: "log", level: "info", msg: `packed: ${packed.length} bytes` });

    await publishEvent(job.jobId, { type: "step", step: "PROPOSE_EDL", status: "running" });
    const edl = await proposeEDL({
      packed,
      direction: payload.direction,
      targetDurationSec: payload.targetDurationSec,
      allowedSourceIds: ["src-0"],
    });
    await publishEvent(job.jobId, {
      type: "log",
      level: "info",
      msg: `EDL: ${edl.entries.length} cuts, total ${edlDuration(edl).toFixed(1)}s`,
    });

    await publishEvent(job.jobId, { type: "step", step: "COMPOSE_OVER_EDL", status: "running" });
    const composition = composeOverEDL(edl, sourceLocal, preset, job.projectId);

    await publishEvent(job.jobId, { type: "step", step: "LINT", status: "running" });
    const html0 = buildCompositionHtml({ preset, composition });
    const { html, errors } = await lintAndHeal(html0, {
      retry: async () => html0,
    });
    await persistComposition.save(job.projectId, composition, html);
    await publishEvent(job.jobId, {
      type: "log",
      level: errors.length === 0 ? "info" : "warn",
      msg: `lint: ${errors.length} error(s)`,
    });

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
    const blocking = Object.values(gateReport).filter(
      (g) => g && !g.pass && g.severity === "block",
    );
    if (blocking.length > 0) {
      throw new Error(`blocking gate failures: ${blocking.map((g) => g!.id).join(", ")}`);
    }

    await publishEvent(job.jobId, {
      type: "done",
      url: renderRes.publicUrl,
      gates: summarise(gateReport),
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

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

async function stageSource(uri: string, workDir: string): Promise<string> {
  if (uri.startsWith("oci://") && process.env.STORAGE_BUCKET) {
    const { getStorage } = await import("@hyperframe-editor/storage");
    const storage = getStorage();
    const { key } = storage.parseUri(uri);
    const buf = await storage.getObject(key);
    const local = join(workDir, "input.mp4");
    await writeFile(local, buf);
    return local;
  }
  if (uri.startsWith("file://")) return uri.replace(/^file:\/\//, "");
  // local path
  return uri;
}

async function transcribeOrStub(wavPath: string, language?: string) {
  if (process.env.GOOGLE_CLOUD_PROJECT || process.env.VERTEX_PROJECT) {
    const bytes = await readFile(wavPath);
    const r = await vertex.transcribe({
      audio: { bytes, mimeType: "audio/wav" },
      language,
      withSpeakers: true,
    });
    return r.segments;
  }
  // Deterministic stub: 8 fake segments evenly spaced. Lets editSource exercise
  // its full pipeline without paid calls in CI.
  const total = 30;
  const seg = total / 8;
  return Array.from({ length: 8 }, (_, i) => ({
    start: i * seg,
    end: (i + 1) * seg,
    text: `synthetic segment ${i + 1}`,
    speaker: i % 2 === 0 ? "S0" : "S1",
  }));
}

function edlDuration(edl: EDL): number {
  return edl.entries.reduce((a, e) => a + (e.out - e.in), 0);
}

function composeOverEDL(
  edl: EDL,
  sourceLocal: string,
  preset: ReturnType<typeof getPreset>,
  projectId: string,
): Composition {
  // For MVP we map each EDL entry to a "video" clip on track 0, played from in
  // → out. Captions / B-rolls come in Phase 2. The clips reference the local
  // source path; the renderer mounts the same workDir during render so the
  // path stays valid.
  const clips: Composition["clips"] = [];
  let t = 0;
  let i = 0;
  for (const e of edl.entries) {
    const dur = (e.out - e.in) / (e.speed || 1);
    clips.push({
      id: `cut-${i++}`,
      kind: "video",
      trackIndex: 0,
      start: Number(t.toFixed(3)),
      duration: Number(dur.toFixed(3)),
      playbackOffset: e.in,
      props: { src: sourceLocal },
    });
    t += dur;
  }
  const composition: Composition = {
    id: projectId,
    canvas: preset.canvas,
    duration: 0,
    assets: [
      {
        id: "src-0",
        kind: "video",
        src: sourceLocal,
      },
    ],
    clips,
    variables: {},
  };
  composition.duration = computeDuration(composition);
  return composition;
}

function summarise(report: Awaited<ReturnType<typeof runGates>>) {
  const out = {} as Record<string, "pass" | "warn" | "fail">;
  for (const [id, r] of Object.entries(report)) {
    if (!r) continue;
    out[id] = r.pass ? "pass" : r.severity === "warn" ? "warn" : "fail";
  }
  return out;
}
