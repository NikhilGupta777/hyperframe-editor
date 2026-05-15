/**
 * Render runner. Two backends:
 *
 *   - hyperframes (production): embeds @hyperframes/producer's programmatic API
 *     `createRenderJob` + `executeRenderJob`. Requires Chromium + ffmpeg in the
 *     image (worker Dockerfile §8.1).
 *
 *   - synthetic (CI / smoke): emits a deterministic MP4 with ffmpeg's color
 *     source so the gates (G3, G6, G8) have something to evaluate. Lets us
 *     exercise the full job pipeline in CI without provisioning Chromium.
 *
 * Selection: env `RENDER_BACKEND=synthetic` or `=hyperframes` (default `synthetic`
 * unless `HYPERFRAMES_PRODUCER_AVAILABLE=1` is set).
 */
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { execa } from "execa";

import { type Composition, type Preset } from "@hyperframe-editor/core";
import { buildCompositionHtml } from "@hyperframe-editor/compose";

export interface RenderRequest {
  projectId: string;
  composition: Composition;
  preset: Preset;
  workDir: string;
  onProgress?: (pct: number, frame?: number, total?: number) => void | Promise<void>;
}

export interface RenderResult {
  mp4Path: string;
  htmlPath: string;
  /** URLs the renderer's Chromium fetched. Empty for the synthetic backend. */
  networkLog: string[];
  /** Public URL for the rendered MP4. May be a file:// or oci:// URI in offline mode. */
  publicUrl: string;
}

export async function runRender(req: RenderRequest): Promise<RenderResult> {
  // Always write the HTML to disk first so G2 can lint it and G7 can inspect.
  const html = buildCompositionHtml({ preset: req.preset, composition: req.composition });
  const htmlPath = join(req.workDir, "composition.html");
  await fs.writeFile(htmlPath, html, "utf8");

  const backend = pickBackend();

  if (backend === "synthetic") {
    const { mp4Path } = await renderSynthetic(req, htmlPath);
    return { mp4Path, htmlPath, networkLog: [], publicUrl: `file://${mp4Path}` };
  }
  return renderHyperframes(req, htmlPath);
}

function pickBackend(): "hyperframes" | "synthetic" {
  const explicit = process.env.RENDER_BACKEND;
  if (explicit === "hyperframes" || explicit === "synthetic") return explicit;
  return process.env.HYPERFRAMES_PRODUCER_AVAILABLE === "1" ? "hyperframes" : "synthetic";
}

async function renderSynthetic(
  req: RenderRequest,
  _htmlPath: string,
): Promise<{ mp4Path: string }> {
  const { width, height, fps } = req.composition.canvas;
  const duration = req.composition.duration;
  const mp4Path = join(req.workDir, "out.mp4");

  // Two-tier filter graph. The pretty path uses drawtext (requires ffmpeg
  // built with libfreetype) so G6 sees luma variation. The fallback path is a
  // plain colour source — still deterministic, still passes G3/G8, just won't
  // exercise drawtext-dependent gates. We sniff the filter list once per
  // process; ffmpeg builds without libfreetype are common on minimal images
  // (e.g. johnvansickle.com/ffmpeg static).
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

  // Coarse progress emission — synthetic renders are < 1 sec but we still tick.
  await req.onProgress?.(10);
  await execa("ffmpeg", args, { reject: true });
  await req.onProgress?.(100, Math.round(duration * fps), Math.round(duration * fps));
  return { mp4Path };
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

async function renderHyperframes(
  req: RenderRequest,
  htmlPath: string,
): Promise<RenderResult> {
  // Lazy import: keep the producer optional so the worker still builds without
  // it (e.g. when running gate smoke tests locally).
  let createRenderJob: (...a: unknown[]) => unknown;
  let executeRenderJob: (...a: unknown[]) => Promise<{ outputPath: string }>;
  try {
    const mod = (await import(
      // The dist path of @hyperframes/producer when installed in production.
      // We import dynamically and fall back to synthetic on failure.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      /* @vite-ignore */ "@hyperframes/producer" as never
    )) as unknown as {
      createRenderJob: (...a: unknown[]) => unknown;
      executeRenderJob: (...a: unknown[]) => Promise<{ outputPath: string }>;
    };
    createRenderJob = mod.createRenderJob;
    executeRenderJob = mod.executeRenderJob;
  } catch {
    console.warn(
      "[render] @hyperframes/producer not available; falling back to synthetic.",
    );
    const { mp4Path } = await renderSynthetic(req, htmlPath);
    return { mp4Path, htmlPath, networkLog: [], publicUrl: `file://${mp4Path}` };
  }

  const outputPath = join(req.workDir, "out.mp4");
  const job = createRenderJob({
    projectDir: req.workDir,
    outputPath,
    fps: { num: req.composition.canvas.fps, den: 1 },
    quality: "high",
    format: "mp4",
    workers: "auto",
    useGpu: false,
    debug: false,
  });
  // Network capture would be a Producer hook in a full integration — we stub
  // an empty list for now; G7 then reports {skipped: ...}.
  const networkLog: string[] = [];
  const result = await executeRenderJob(job, {
    onProgress: (p: { pct?: number; frame?: number; total?: number }) =>
      req.onProgress?.(p.pct ?? 0, p.frame, p.total),
  } as never);
  return {
    mp4Path: result.outputPath ?? outputPath,
    htmlPath,
    networkLog,
    publicUrl: `file://${result.outputPath ?? outputPath}`,
  };
}
