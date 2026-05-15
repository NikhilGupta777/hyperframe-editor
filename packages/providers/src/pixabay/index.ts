/**
 * Pixabay adapter. Free key, ~100 req/min, no attribution required.
 * Docs: https://pixabay.com/api/docs/
 *
 * Returns images and videos under one search; we route by `kind`.
 */
import type { StockHit, StockSearchOptions } from "../stock-types.js";

const BASE = "https://pixabay.com/api/";

interface PixabayImageHit {
  id: number;
  webformatURL: string;
  largeImageURL: string;
  imageWidth: number;
  imageHeight: number;
  pageURL: string;
  user: string;
}
interface PixabayImageResp {
  hits: PixabayImageHit[];
}

interface PixabayVideoHit {
  id: number;
  duration: number;
  pageURL: string;
  user: string;
  videos: {
    large?: { url: string; width: number; height: number };
    medium?: { url: string; width: number; height: number };
    small?: { url: string; width: number; height: number };
    tiny?: { url: string; width: number; height: number };
  };
  picture_id?: string;
}
interface PixabayVideoResp {
  hits: PixabayVideoHit[];
}

function mapOrientation(o: StockSearchOptions["orientation"]): string {
  switch (o) {
    case "horizontal":
      return "horizontal";
    case "vertical":
      return "vertical";
    default:
      return "all";
  }
}

export async function search(opts: StockSearchOptions): Promise<StockHit[]> {
  const key = process.env.PIXABAY_API_KEY;
  if (!key) throw new Error("PIXABAY_API_KEY not set");
  const kind = opts.kind ?? "image";
  const perPage = Math.max(3, Math.min(opts.perPage ?? 20, 50));

  if (kind === "video") {
    const url = new URL(`${BASE}videos/`);
    url.searchParams.set("key", key);
    url.searchParams.set("q", opts.query);
    url.searchParams.set("per_page", String(perPage));
    url.searchParams.set("safesearch", "true");
    const r = await fetch(url, { headers: { accept: "application/json" } });
    if (!r.ok) throw new Error(`Pixabay video search failed: ${r.status} ${r.statusText}`);
    const data = (await r.json()) as PixabayVideoResp;
    return data.hits.map<StockHit>((h) => {
      const video = h.videos.large ?? h.videos.medium ?? h.videos.small ?? h.videos.tiny;
      const w = video?.width ?? 1280;
      const ht = video?.height ?? 720;
      return {
        id: String(h.id),
        provider: "pixabay",
        kind: "video",
        previewUrl: video?.url ?? "",
        downloadUrl: video?.url ?? "",
        width: w,
        height: ht,
        durationSec: h.duration,
        attribution: {
          provider: "Pixabay",
          author: h.user,
          sourceUrl: h.pageURL,
          license: "Pixabay License (no attribution required)",
        },
      };
    });
  }

  const url = new URL(BASE);
  url.searchParams.set("key", key);
  url.searchParams.set("q", opts.query);
  url.searchParams.set("per_page", String(perPage));
  url.searchParams.set("orientation", mapOrientation(opts.orientation));
  url.searchParams.set("safesearch", "true");
  const r = await fetch(url, { headers: { accept: "application/json" } });
  if (!r.ok) throw new Error(`Pixabay image search failed: ${r.status} ${r.statusText}`);
  const data = (await r.json()) as PixabayImageResp;
  return data.hits.map<StockHit>((h) => ({
    id: String(h.id),
    provider: "pixabay",
    kind: "image",
    previewUrl: h.webformatURL,
    downloadUrl: h.largeImageURL,
    width: h.imageWidth,
    height: h.imageHeight,
    attribution: {
      provider: "Pixabay",
      author: h.user,
      sourceUrl: h.pageURL,
      license: "Pixabay License (no attribution required)",
    },
  }));
}
