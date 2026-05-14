/**
 * Unsplash adapter. Demo: 50 req/hour. Production needs application approval.
 *
 * Attribution is mandatory: photographer name + Unsplash profile URL + a credit
 * link to Unsplash. The orchestrator records this on the project and the editor
 * surfaces an Attribution tab.
 *
 * Endpoint: GET https://api.unsplash.com/search/photos?query=...
 * Auth: Authorization: Client-ID <KEY>
 */
import type { StockHit, StockSearchOptions } from "../stock-types.js";

const BASE = "https://api.unsplash.com/search/photos";

interface UnsplashUser {
  name: string;
  links: { html: string };
}
interface UnsplashPhoto {
  id: string;
  width: number;
  height: number;
  urls: { regular: string; full: string; raw: string };
  user: UnsplashUser;
  links: { html: string; download_location: string };
}
interface UnsplashResp {
  results: UnsplashPhoto[];
}

function mapOrientation(o: StockSearchOptions["orientation"]): string | null {
  switch (o) {
    case "horizontal":
      return "landscape";
    case "vertical":
      return "portrait";
    case "square":
      return "squarish";
    default:
      return null;
  }
}

export async function search(opts: StockSearchOptions): Promise<StockHit[]> {
  if ((opts.kind ?? "image") !== "image") return []; // Unsplash is images only.
  const key = process.env.UNSPLASH_ACCESS_KEY;
  if (!key) throw new Error("UNSPLASH_ACCESS_KEY not set");

  const url = new URL(BASE);
  url.searchParams.set("query", opts.query);
  url.searchParams.set("per_page", String(Math.max(1, Math.min(opts.perPage ?? 20, 30))));
  const ori = mapOrientation(opts.orientation);
  if (ori) url.searchParams.set("orientation", ori);

  const r = await fetch(url, {
    headers: {
      "Accept-Version": "v1",
      Authorization: `Client-ID ${key}`,
    },
  });
  if (!r.ok) throw new Error(`Unsplash search failed: ${r.status} ${r.statusText}`);
  const data = (await r.json()) as UnsplashResp;

  return data.results.map<StockHit>((p) => ({
    id: p.id,
    provider: "unsplash",
    kind: "image",
    previewUrl: p.urls.regular,
    downloadUrl: p.urls.full,
    width: p.width,
    height: p.height,
    attribution: {
      provider: "Unsplash",
      author: p.user.name,
      authorUrl: `${p.user.links.html}?utm_source=hyperframe-editor&utm_medium=referral`,
      sourceUrl: `${p.links.html}?utm_source=hyperframe-editor&utm_medium=referral`,
      license: "Unsplash License (attribution required)",
    },
  }));
}

/**
 * Unsplash requires us to ping the download_location endpoint when a user actually
 * downloads a photo. Call this right before fetching the bytes.
 */
export async function trackDownload(downloadLocation: string): Promise<void> {
  const key = process.env.UNSPLASH_ACCESS_KEY;
  if (!key) return;
  await fetch(downloadLocation, {
    headers: { Authorization: `Client-ID ${key}` },
  }).catch(() => undefined);
}
