/**
 * Render runner. Two backends:
 *
 *   - hyperframes (production, DEFAULT): drives the real
 *     @hyperframes/producer pipeline — Chromium frame capture → ffmpeg
 *     encode → assemble. Requires Chromium accessible via puppeteer's
 *     default cache (the worker Dockerfile bakes that in via
 *     `npx hyperframes browser ensure`).
 *
 *   - synthetic (CI / smoke / explicit opt-in): emits a deterministic MP4
 *     with ffmpeg's color source so the gates (G3, G6, G8) have something
 *     to evaluate without provisioning Chromium. Selected ONLY when
 *     `RENDER_BACKEND=synthetic` is set explicitly. Production never sets
 *     it, so we never silently fall back to the placeholder.
 *
 * Selection precedence:
 *   1. `RENDER_BACKEND` env var if set ("hyperframes" | "synthetic").
 *   2. Otherwise, default = "hyperframes".
 *
 * Earlier waves defaulted to synthetic and probed for an env flag to
 * upgrade — that meant any forgotten env config silently shipped fake
 * renders to users. The default is now real; a missing Chromium throws,
 * loud and obvious.
 */
import { promises as fs } from "node:fs";
import { dirname, join } from "node:path";
import { execa } from "execa";

import { type Composition, type Preset } from "@hyperframe-editor/core";
import { buildCompositionHtml } from "@hyperframe-editor/compose";

import { captureNetworkLog } from "./networkCapture.js";

export interface RenderRequest {
  projectId: string;
  composition: Composition;
  preset: Preset;
  workDir: string;
  onProgress?: (pct: number, frame?: number, total?: number) => void | Promise<void>;
  /**
   * Optional render abort signal. The producer threads this through every
   * stage; cancelling here kills Chromium and ffmpeg cleanly.
   */
  signal?: AbortSignal;
}

export interface RenderResult {
  /** Absolute path to the rendered MP4 on the worker's filesystem. */
  mp4Path: string;
  /** Absolute path to the composition.html the renderer consumed. */
  htmlPath: string;
  /**
   * Distinct URLs the renderer's Chromium fetched during a scout pass.
   * Empty for the synthetic backend; non-empty (or with a `skipped`
   * reason in the orchestrator log) for the hyperframes backend.
   */
  networkLog: string[];
  /**
   * Public URL for the rendered MP4. May be a `file://` URI when the
   * worker runs without OCI configured; the orchestrator's `finalize`
   * step replaces this with a signed `https://` URL after upload.
   */
  publicUrl: string;
  /**
   * Total frames captured. Reported by the producer; used by gate G3 to
   * cross-check duration against the composition's `data-duration`.
   */
  totalFrames?: number;
  /** Wall-clock ms spent in the render pipeline. */
  elapsedMs: number;
}

export async function runRender(req: RenderRequest): Promise<RenderResult> {
  // Always write the HTML to disk first so G2 can lint it, G7 can scout it,
  // and the producer has a stable on-disk artifact to compile.
  const html = buildCompositionHtml({ preset: req.preset, composition: req.composition });
  const htmlPath = join(req.workDir, "composition.html");
  await fs.writeFile(htmlPath, html, "utf8");

  const backend = pickBackend();
  const start = Date.now();

  if (backend === "synthetic") {
    const { mp4Path, totalFrames } = await renderSynthetic(req, htmlPath);
    return {
      mp4Path,
      htmlPath,
      networkLog: [],
      publicUrl: `file://${mp4Path}`,
      totalFrames,
      elapsedMs: Date.now() - start,
    };
  }

  return renderHyperframes(req, htmlPath, start);
}

function pickBackend(): "hyperframes" | "synthetic" {
  const explicit = process.env.RENDER_BACKEND;
  if (explicit === "synthetic") return "synthetic";
  if (explicit === "hyperframes") return "hyperframes";
  // Default flipped to hyperframes (PR 1, May 2026). The previous default
  // was synthetic-with-an-upgrade-flag; that masked deploy-config errors
  // by silently producing flat-color MP4s.
  return "hyperframes";
}

// ---------------------------------------------------------------------------
// Hyperframes backend
// ---------------------------------------------------------------------------

async function renderHyperframes(
  req: RenderRequest,
  htmlPath: string,
  start: number,
): Promise<RenderResult> {
  // 1. Network scout. We do this BEFORE the heavy render so a network-only
  //    failure (off-origin fetch) can be reported as a G7 fail without
  //    burning Chromium for a 60-second capture run. The scout reuses the
  //    same composition.html the renderer will load, so every fetch the
  //    real render would issue is observed here.
  const scout = await captureNetworkLog(htmlPath, { captureMs: 4000 });

  // 2. Drive the producer. Lazy import so the synthetic backend keeps
  //    working in environments without @hyperframes/producer installed
  //    (e.g. partial CI matrices).
  // Producer's TypeScript source ships with browser-side helpers that pull
  // in @webgpu/types and other deps that aren't installed in the worker
  // runtime. We don't need those for our minimal use of the producer (just
  // createRenderJob / executeRenderJob), so the import is type-erased.
  type ProducerJobSnapshot = {
    progress?: number;
    framesRendered?: number;
    totalFrames?: number;
  };
  type ProducerRenderJob = ProducerJobSnapshot & {
    id: string;
    outputPath?: string;
  };
  type ProducerModule = {
    createRenderJob: (config: Record<string, unknown>) => ProducerRenderJob;
    executeRenderJob: (
      job: ProducerRenderJob,
      projectDir: string,
      outputPath: string,
      onProgress?: (job: ProducerRenderJob, message: string) => void,
      abortSignal?: AbortSignal,
    ) => Promise<void>;
  };
  let createRenderJob: ProducerModule["createRenderJob"];
  let executeRenderJob: ProducerModule["executeRenderJob"];
  try {
    const mod = (await import(
      // String concat dodges TypeScript's static module resolution; we want
      // the runtime require, not the compile-time deep type check.
      "@hyperframes/producer" + ""
    )) as ProducerModule;
    createRenderJob = mod.createRenderJob;
    executeRenderJob = mod.executeRenderJob;
  } catch (e) {
    throw new Error(
      `Hyperframes Producer is required for RENDER_BACKEND=hyperframes but failed to load: ${(e as Error).message}. ` +
        `Install @hyperframes/producer in the worker image, or set RENDER_BACKEND=synthetic for offline tests.`,
    );
  }

  const projectDir = dirname(htmlPath); // == req.workDir
  const outputPath = join(req.workDir, "out.mp4");

  const job = createRenderJob({
    fps: { num: req.composition.canvas.fps, den: 1 },
    quality: producerQuality(),
    format: "mp4",
    workers: producerWorkers(),
    useGpu: false,
    debug: process.env.HYPERFRAMES_DEBUG === "1",
    entryFile: "composition.html",
  });

  // The producer's onProgress callback fires per stage with a job snapshot.
  // We translate `(stage, framesRendered/totalFrames, status)` into our
  // `(pct, frame, total)` shape so the SSE stream stays consistent across
  // backends.
  await executeRenderJob(
    job,
    projectDir,
    outputPath,
    (snap, _msg) => {
      const total = snap.totalFrames ?? 0;
      const done = snap.framesRendered ?? 0;
      const pct =
        total > 0
          ? Math.min(99, Math.round((done / total) * 100))
          : Math.min(99, Math.round((snap.progress ?? 0) * 100));
      void req.onProgress?.(pct, done, total);
    },
    req.signal,
  );

  // The producer writes outputPath; double-check before proceeding.
  await fs.access(outputPath).catch(() => {
    throw new Error(`Hyperframes producer claimed success but ${outputPath} is missing`);
  });
  await req.onProgress?.(100, job.totalFrames, job.totalFrames);

  return {
    mp4Path: outputPath,
    htmlPath,
    networkLog: scout.urls,
    publicUrl: `file://${outputPath}`,
    totalFrames: job.totalFrames,
    elapsedMs: Date.now() - start,
  };
}

function producerQuality(): "draft" | "standard" | "high" {
  const q = process.env.RENDER_QUALITY?.toLowerCase();
  if (q === "draft" || q === "standard" || q === "high") return q;
  return "high";
}

function producerWorkers(): number {
  const w = Number(process.env.RENDER_WORKERS ?? "");
  if (Number.isFinite(w) && w >= 1) return Math.floor(w);
  // Conservative default. Oracle A1 4-OCPU box runs 2 concurrent renders
  // happily at 2 workers each. Single render scaling tops out around 4.
  return 2;
}

// ---------------------------------------------------------------------------
// Synthetic backend (CI / smoke only)
// ---------------------------------------------------------------------------

async function renderSynthetic(
  req: RenderRequest,
  _htmlPath: string,
): Promise<{ mp4Path: string; totalFrames: number }> {
  const { width, height, fps } = req.composition.canvas;
  const duration = req.composition.duration;
  const mp4Path = join(req.workDir, "out.mp4");
  const totalFrames = Math.round(duration * fps);

  // Two-tier filter graph. The pretty path uses drawtext (requires ffmpeg
  // built with libfreetype) so G6 sees luma variation. The fallback is a
  // plain colour source — still deterministic, still passes G3/G8.
  const colorSrc = `color=c=0x223344:s=${width}x${height}:d=${duration.toFixed(3)}:r=${fps}`;
  const drawTextOk = await canUseDrawText();

  const args: string[] = ["-y", "-f", "lavfi", "-i", colorSrc];
  if (drawTextOk) {
    args.push(
      "-vf",
      `drawtext=text='hyperframe-editor smoke ${req.projectId}':fontcolor=white:fontsize=42:x=(w-text_w)/2:y=(h-text_h)/2`,
    );
  }
  args.push("-pix_fmt", "yuv420p", "-movflags", "+faststart", mp4Path);

  await req.onProgress?.(10);
  await execa("ffmpeg", args, { reject: true });
  await req.onProgress?.(100, totalFrames, totalFrames);
  return { mp4Path, totalFrames };
}

let drawTextSupported: boolean | null = null;
async function canUseDrawText(): Promise<boolean> {
  if (drawTextSupported !== null) return drawTextSupported;
  try {
    const { stdout } = await execa("ffmpeg", ["-hide_banner", "-filters"], {
      reject: false,
    });
    drawTextSupported = /\bdrawtext\b/.test(stdout);
  } catch {
    drawTextSupported = false;
  }
  return drawTextSupported;
}
