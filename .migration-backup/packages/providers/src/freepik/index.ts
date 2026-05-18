/**
 * Freepik adapter. BYOK only — Freepik is pay-as-you-go. We expose it as a power-user
 * escape hatch with the user's own API key passed per request.
 *
 * Docs: https://docs.freepik.com/api-reference (subject to change; this adapter
 * focuses on the stable resources/search endpoint).
 */
import type { StockHit, StockSearchOptions } from "../stock-types.js";

const BASE = "https://api.freepik.com/v1/resources";

interface FreepikItem {
  id: number;
  title: string;
  url: string;
  image: { source: { url: string }; width?: number; height?: number };
  licenses?: Array<{ name: string }>;
  author?: { name?: string };
}
interface FreepikResp {
  data: FreepikItem[];
}

export interface FreepikSearchOptions extends StockSearchOptions {
  apiKey: string;
}

export async function search(opts: FreepikSearchOptions): Promise<StockHit[]> {
  const url = new URL(BASE);
  url.searchParams.set("term", opts.query);
  url.searchParams.set("limit", String(Math.max(1, Math.min(opts.perPage ?? 20, 50))));
  if (opts.kind === "video") url.searchParams.set("filters[content_type][video]", "1");
  else url.searchParams.set("filters[content_type][photo]", "1");

  const r = await fetch(url, {
    headers: {
      "x-freepik-api-key": opts.apiKey,
      accept: "application/json",
    },
  });
  if (!r.ok) throw new Error(`Freepik search failed: ${r.status} ${r.statusText}`);
  const data = (await r.json()) as FreepikResp;

  return data.data.map<StockHit>((it) => ({
    id: String(it.id),
    provider: "freepik",
    kind: opts.kind ?? "image",
    previewUrl: it.image.source.url,
    downloadUrl: it.image.source.url,
    width: it.image.width ?? 0,
    height: it.image.height ?? 0,
    attribution: {
      provider: "Freepik",
      author: it.author?.name,
      sourceUrl: it.url,
      license: it.licenses?.[0]?.name ?? "Freepik license",
    },
  }));
}
