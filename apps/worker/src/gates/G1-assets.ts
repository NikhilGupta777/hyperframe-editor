/**
 * G1 — every asset referenced by the composition must be reachable.
 *
 * Walks the AST and any explicit `assets[]` entries. For local paths we stat
 * the file. For oci:// we HEAD the bucket key. For https:// we issue a HEAD
 * request — if the asset is meant to be vendored before render we expect this
 * to be a fail until the orchestrator downloads it.
 */
import { promises as fs } from "node:fs";
import type { GateContext } from "./runner.js";
import type { GateResult } from "@hyperframe-editor/core";

interface Issue {
  ref: string;
  reason: string;
}

export async function gateG1(ctx: GateContext): Promise<Omit<GateResult, "id" | "severity">> {
  const refs = collectAssetRefs(ctx.composition);
  const missing: Issue[] = [];

  for (const ref of refs) {
    if (ref.startsWith("oci://")) {
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
    // local relative path
    try {
      await fs.access(ref);
    } catch {
      missing.push({ ref, reason: "local file not found" });
    }
  }

  if (missing.length > 0) {
    return {
      pass: false,
      details: { missing },
      fix: "re-fetch / regenerate the missing assets before render",
    };
  }
  return { pass: true, details: { checked: refs.length } };
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
