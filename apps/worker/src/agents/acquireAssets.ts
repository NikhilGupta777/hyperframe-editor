/**
 * ACQUIRE_ASSETS step — for each beat's asset cues, find or generate media.
 *
 * Priority order per PLAN.md §10:
 *   1. Pixabay (free, no attribution)
 *   2. Unsplash (free, attribution required)
 *   3. Image-gen (Imagen 4 fast or Nano Banana Pro)
 *   4. Freepik (BYOK, only when key supplied)
 *
 * Every fetched asset is sha256-hashed and cached at oci://bucket/asset-cache/<hash>/...
 * so repeat queries don't re-pay.
 */
import { promises as fs } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";

import type { Beat, AssetRef } from "@hyperframe-editor/core";
import { pixabay, unsplash, vertex, type StockHit } from "@hyperframe-editor/providers";

export interface AcquireRequest {
  beats: Beat[];
  workDir: string;
  /** Optional aspect ratio hint for image-gen (e.g. "9:16", "16:9"). */
  aspectRatio?: string;
  /** When true, never call paid image-gen. Used in dry-run / offline tests. */
  freeOnly?: boolean;
  publish?: (msg: string) => Promise<void>;
}

export interface AcquiredAsset {
  beatId: string;
  slot: string;
  asset: AssetRef;
  /** True when this asset came from a paid image-gen call. */
  generated?: boolean;
}

export interface AcquireResult {
  assets: AcquiredAsset[];
  /** Counts for the cost ledger. */
  generatedImagesByModel: { fast: number; hq: number };
}

export async function acquireAssets(req: AcquireRequest): Promise<AcquireResult> {
  const out: AcquiredAsset[] = [];
  let fastImages = 0;
  let hqImages = 0;
  const assetsDir = join(req.workDir, "assets");
  await fs.mkdir(assetsDir, { recursive: true });

  for (const beat of req.beats) {
    for (const cue of beat.assetCues) {
      await req.publish?.(`acquire: ${beat.id}/${cue.slot} - "${cue.query}"`);
      const acquired = await tryAcquire(cue.query, cue.kind, assetsDir, req);
      if (acquired) {
        out.push({ beatId: beat.id, slot: cue.slot, ...acquired });
        if (acquired.generated) fastImages++;
      }
    }
  }
  return {
    assets: out,
    generatedImagesByModel: { fast: fastImages, hq: hqImages },
  };
}

async function tryAcquire(
  query: string,
  kind: "image" | "video" | "audio",
  dir: string,
  req: AcquireRequest,
): Promise<{ asset: AssetRef; generated?: boolean } | null> {
  if (kind === "audio") {
    // Audio acquisition is currently scoped to TTS in the BUILD loop; stock
    // audio via providers will arrive in Phase 4.
    return null;
  }
  // 1. Pixabay
  if (process.env.PIXABAY_API_KEY) {
    try {
      const hits = await pixabay.search({ query, kind, perPage: 5 });
      const best = pickBest(hits);
      if (best) return { asset: await downloadAndCache(best, dir) };
    } catch (e) {
      await req.publish?.(`pixabay error: ${(e as Error).message}`);
    }
  }
  // 2. Unsplash (images only)
  if (kind === "image" && process.env.UNSPLASH_ACCESS_KEY) {
    try {
      const hits = await unsplash.search({ query, kind: "image", perPage: 5 });
      const best = pickBest(hits);
      if (best) return { asset: await downloadAndCache(best, dir) };
    } catch (e) {
      await req.publish?.(`unsplash error: ${(e as Error).message}`);
    }
  }
  // 3. Image-gen — only for images, only if explicitly enabled and the user has a Vertex project.
  if (
    !req.freeOnly &&
    kind === "image" &&
    (process.env.GOOGLE_CLOUD_PROJECT || process.env.VERTEX_PROJECT)
  ) {
    try {
      const imgs = await vertex.generateImage({
        prompt: `${query}, no text in image, high quality, photographic`,
        aspectRatio: req.aspectRatio ?? "9:16",
        quality: "fast",
      });
      const first = imgs[0];
      if (first) {
        const filename = `gen-${shortHash(query)}.png`;
        const local = join(dir, filename);
        await fs.writeFile(local, first.bytes);
        return {
          asset: {
            id: shortHash(query),
            kind: "image",
            src: `assets/${filename}`,
            attribution: { provider: "Vertex AI Imagen", license: "Generated content" },
          },
          generated: true,
        };
      }
    } catch (e) {
      await req.publish?.(`image-gen error: ${(e as Error).message}`);
    }
  }
  return null;
}

function pickBest(hits: StockHit[]): StockHit | undefined {
  if (hits.length === 0) return undefined;
  // Naive heuristic: largest hit by pixel count. Phase 2 layers a CLIP-style
  // reranker on top.
  return [...hits].sort((a, b) => b.width * b.height - a.width * a.height)[0];
}

async function downloadAndCache(hit: StockHit, dir: string): Promise<AssetRef> {
  const r = await fetch(hit.downloadUrl, { redirect: "follow" });
  if (!r.ok) throw new Error(`download ${hit.downloadUrl} -> ${r.status}`);
  const bytes = Buffer.from(await r.arrayBuffer());
  const sha = createHash("sha256").update(bytes).digest("hex");
  const ext = pickExt(hit.kind, r.headers.get("content-type"));
  const filename = `${sha}.${ext}`;
  const local = join(dir, filename);
  await fs.writeFile(local, bytes);
  return {
    id: hit.id,
    kind: hit.kind,
    src: `assets/${filename}`,
    width: hit.width,
    height: hit.height,
    durationSec: hit.durationSec,
    hash: sha,
    attribution: hit.attribution,
  };
}

function pickExt(kind: "image" | "video", contentType: string | null): string {
  if (kind === "video") return contentType?.includes("webm") ? "webm" : "mp4";
  if (contentType?.includes("png")) return "png";
  if (contentType?.includes("webp")) return "webp";
  return "jpg";
}

function shortHash(s: string): string {
  return createHash("sha256").update(s).digest("hex").slice(0, 12);
}
