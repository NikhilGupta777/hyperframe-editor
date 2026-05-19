/**
 * G1 — every asset referenced by the composition must be reachable.
 *
 * Walks the AST and any explicit `assets[]` entries. For local paths we stat
 * the file; for `oci://` we HEAD the bucket key; for `https://` we issue a
 * HEAD request — if the asset is meant to be vendored before render we expect
 * this to be a fail until the orchestrator downloads it.
 *
 * Path resolution:
 *   Compositions reference assets with paths relative to the composition.html
 *   (e.g. `assets/cuts.mp4`). Earlier we resolved these against
 *   `process.cwd()`, which silently broke whenever the worker ran from a
 *   different directory than the composition's workDir. We now resolve
 *   relative paths against `dirname(htmlPath)` so the gate's view of the
 *   filesystem matches the renderer's.
 */
import { promises as fs } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import type { GateContext } from "./runner.js";
import type { GateResult } from "@hyperframe-editor/core";

interface Issue {
  ref: string;
  reason: string;
}

export async function gateG1(ctx: GateContext): Promise<Omit<GateResult, "id" | "severity">> {
  const refs = collectAssetRefs(ctx.composition);
  const missing: Issue[] = [];
  const baseDir = ctx.htmlPath ? dirname(ctx.htmlPath) : process.cwd();

  for (const ref of refs) {
    if (ref.startsWith("oci://") || ref.startsWith("s3://")) {
      try {
        const { getStorage } = await import("@hyperframe-editor/storage");
        const storage = getStorage();
        const { key } = storage.parseUri(ref);
        const ok = await storage.headObject(key);
        if (!ok) missing.push({ ref, reason: "object not found in bucket" });
      } catch (e) {
        missing.push({ ref, reason: `oci probe failed: ${e instanceof Error ? e.message : String(e)}` });
      }
      continue;
    }
    if (ref.startsWith("http://") || ref.startsWith("https://")) {
      try {
        const r = await fetch(ref, { method: "HEAD" });
        if (!r.ok) missing.push({ ref, reason: `HEAD ${ref} -> ${r.status}` });
      } catch (e) {
        missing.push({ ref, reason: `fetch failed: ${e instanceof Error ? e.message : String(e)}` });
      }
      continue;
    }
    // file:// or local path. Resolve relative paths against the composition's
    // directory so they line up with what the renderer would see.
    const localPath = ref.startsWith("file://")
      ? ref.replace(/^file:\/\//, "")
      : isAbsolute(ref)
        ? ref
        : resolve(baseDir, ref);
    try {
      await fs.access(localPath);
    } catch {
      missing.push({ ref, reason: `local file not found at ${localPath}` });
    }
  }

  if (missing.length > 0) {
    return {
      pass: false,
      details: { missing, baseDir },
      fix: "re-fetch / regenerate the missing assets before render",
    };
  }
  return { pass: true, details: { checked: refs.length, baseDir } };
}

function collectAssetRefs(c: GateContext["composition"]): string[] {
  const out: string[] = [];
  for (const a of c.assets) out.push(a.src);
  for (const clip of c.clips) {
    if (clip.kind === "video" || clip.kind === "image" || clip.kind === "audio") {
      const src = (clip.props as { src?: string }).src;
      if (typeof src === "string") out.push(src);
    }
  }
  return out;
}
