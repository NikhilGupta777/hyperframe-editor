/**
 * Render finalize stage. Runs after gates pass; before the orchestrator
 * announces `done`.
 *
 * Responsibilities:
 *   1. Upload `workDir/assets/*` to OCI under `projects/<id>/assets/<name>`.
 *      Composition references these by relative path (e.g. `assets/cuts.mp4`),
 *      so the editor's preview iframe can resolve them via the
 *      `/api/projects/:id/assets/:name` passthrough route.
 *   2. Upload `out.mp4` to OCI under `renders/<id>/<jobId>.mp4`.
 *   3. Return a `https://` signed URL the editor can hand to a `<video>`
 *      tag (via the cost-cheap `getUrl` which returns a public URL when
 *      `STORAGE_PUBLIC_BASE_URL` is set, otherwise a 15-minute signed URL).
 *
 * When STORAGE_BUCKET is unset (smoke runs, local dev without OCI):
 *   - assets stay in workDir (will be cleaned up by the caller's `rm`).
 *   - mp4 stays in workDir.
 *   - publicUrl falls back to the original `file://` URL.
 *
 * The caller is responsible for the workDir cleanup; finalize NEVER deletes
 * files. We don't want a finalize bug to nuke the artifact before the
 * orchestrator reads it.
 */
import { promises as fs } from "node:fs";
import { join, basename, extname } from "node:path";
import { contentType as mimeFor } from "mime-types";

import type { Composition } from "@hyperframe-editor/core";

export interface FinalizeRequest {
  projectId: string;
  jobId: string;
  workDir: string;
  /** Local filesystem path to the rendered MP4. */
  mp4Path: string;
  /** Local filesystem path to the composition.html the renderer used. */
  htmlPath: string;
  /** Composition AST so we can also persist composition.json alongside HTML. */
  composition: Composition;
}

export interface FinalizeResult {
  /**
   * Public URL the editor can play. `https://...` when OCI is configured,
   * otherwise the original `file://` URL (offline mode).
   */
  publicUrl: string;
  /** Canonical oci:// URI of the uploaded MP4, when uploaded. */
  ociUri: string | null;
  /** Number of asset files uploaded under `projects/<id>/assets/`. */
  assetsUploaded: number;
  /** Total bytes pushed to OCI in this finalize pass. */
  bytesUploaded: number;
}

export async function finalizeRender(req: FinalizeRequest): Promise<FinalizeResult> {
  if (!process.env.STORAGE_BUCKET) {
    // No OCI configured — leave artifacts on disk. The caller's `file://`
    // publicUrl is already the correct value.
    return {
      publicUrl: `file://${req.mp4Path}`,
      ociUri: null,
      assetsUploaded: 0,
      bytesUploaded: 0,
    };
  }

  const { getStorage, paths } = await import("@hyperframe-editor/storage");
  const storage = getStorage();
  let bytesUploaded = 0;
  let assetsUploaded = 0;

  // 1. Upload every file in workDir/assets/ under projects/<id>/assets/<name>.
  //    Compositions reference assets relatively (`assets/foo.jpg`); the editor's
  //    /api/projects/:id/assets/:name route reads them from this exact prefix.
  const assetsDir = join(req.workDir, "assets");
  const assetEntries = await listFilesSafely(assetsDir);
  for (const entry of assetEntries) {
    const name = entry.relPath.replace(/^assets\//, "");
    const bytes = await fs.readFile(entry.absPath);
    await storage.putObject(
      paths.asset(req.projectId, name),
      bytes,
      mimeFromExt(entry.absPath),
    );
    bytesUploaded += bytes.byteLength;
    assetsUploaded++;
  }

  // 2. Upload composition.html and composition.json (mirrors what
  //    persistComposition does, but on the freshly-rendered HTML — important
  //    when the producer rewrote any inline content during compile).
  try {
    const renderedHtml = await fs.readFile(req.htmlPath);
    const compositionJsonKey = paths.composition(req.projectId).replace(/\.html$/, ".json");
    await Promise.all([
      storage.putObject(
        paths.composition(req.projectId),
        renderedHtml,
        "text/html; charset=utf-8",
      ),
      storage.putObject(
        compositionJsonKey,
        JSON.stringify(req.composition, null, 2),
        "application/json; charset=utf-8",
      ),
    ]);
    bytesUploaded += renderedHtml.byteLength;
  } catch (e) {
    console.warn(`[finalize] composition snapshot upload skipped: ${(e as Error).message}`);
  }

  // 3. Upload the rendered MP4 under renders/<projectId>/<jobId>.mp4.
  //    We deliberately key by jobId (not a timestamp) so the editor's
  //    render-history view can deep-link a specific render.
  const renderKey = `renders/${req.projectId}/${req.jobId}.mp4`;
  const mp4Bytes = await fs.readFile(req.mp4Path);
  const ociUri = await storage.putObject(renderKey, mp4Bytes, "video/mp4");
  bytesUploaded += mp4Bytes.byteLength;

  // 4. Resolve a viewable URL. `getUrl` prefers the public CDN base
  //    (STORAGE_PUBLIC_BASE_URL) and falls back to a signed URL.
  const publicUrl = await storage.getUrl(renderKey, 60 * 60); // 1 hour
  return {
    publicUrl,
    ociUri,
    assetsUploaded,
    bytesUploaded,
  };
}

async function listFilesSafely(dir: string): Promise<Array<{ absPath: string; relPath: string }>> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const out: Array<{ absPath: string; relPath: string }> = [];
    for (const e of entries) {
      if (!e.isFile()) continue;
      out.push({ absPath: join(dir, e.name), relPath: `assets/${e.name}` });
    }
    return out;
  } catch {
    return [];
  }
}

function mimeFromExt(filePath: string): string {
  const m = mimeFor(extname(filePath));
  return typeof m === "string" ? m : "application/octet-stream";
}

// Keep `basename` referenced so its import lives even if a future refactor
// drops its only use site temporarily.
export const _internal = { basename };
