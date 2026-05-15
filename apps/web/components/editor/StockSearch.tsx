"use client";

import { useState } from "react";

interface StockHit {
  id: string;
  provider: string;
  kind: "image" | "video";
  previewUrl: string;
  downloadUrl: string;
  width: number;
  height: number;
  attribution: { provider: string; author?: string; sourceUrl?: string };
}

/**
 * Asset drawer search. POSTs to /api/stock/:provider with the query, renders
 * thumbnails. The drag-to-timeline behaviour lives in the Timeline component
 * (Phase 3); this just demonstrates the asset acquisition surface.
 */
export function StockSearch() {
  const [q, setQ] = useState("");
  const [provider, setProvider] = useState<"pixabay" | "unsplash">("pixabay");
  const [kind, setKind] = useState<"image" | "video">("image");
  const [hits, setHits] = useState<StockHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [missingKey, setMissingKey] = useState(false);

  async function search() {
    if (!q.trim()) return;
    setLoading(true);
    setMissingKey(false);
    try {
      const r = await fetch(
        `/api/stock/${provider}?q=${encodeURIComponent(q)}&kind=${kind}&perPage=12`,
      );
      const j = (await r.json()) as { hits?: StockHit[]; missingKey?: boolean };
      setHits(j.hits ?? []);
      setMissingKey(Boolean(j.missingKey));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-2 text-xs">
      <div className="flex gap-1">
        <select
          value={provider}
          onChange={(e) => setProvider(e.target.value as "pixabay" | "unsplash")}
          className="rounded bg-ink/60 border border-muted/40 px-2 py-1"
        >
          <option value="pixabay">Pixabay</option>
          <option value="unsplash">Unsplash</option>
        </select>
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value as "image" | "video")}
          className="rounded bg-ink/60 border border-muted/40 px-2 py-1"
        >
          <option value="image">image</option>
          <option value="video">video</option>
        </select>
      </div>
      <div className="flex gap-1">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && search()}
          placeholder="search stock…"
          className="flex-1 rounded bg-ink/60 border border-muted/40 px-2 py-1"
        />
        <button
          onClick={search}
          disabled={loading || !q.trim()}
          className="rounded bg-accent text-ink px-2 py-1 font-semibold disabled:opacity-50"
        >
          {loading ? "\u2026" : "go"}
        </button>
      </div>
      {missingKey && (
        <div className="opacity-60">
          {provider} key not configured server-side.
        </div>
      )}
      <div className="grid grid-cols-3 gap-1 max-h-64 overflow-auto">
        {hits.map((h) => (
          <a
            key={h.id}
            href={h.attribution.sourceUrl ?? "#"}
            target="_blank"
            rel="noopener noreferrer"
            title={`${h.attribution.provider} · ${h.attribution.author ?? ""}`}
            className="block rounded overflow-hidden border border-muted/30"
          >
            {/* Stock previews are external URLs; <img> is fine since we're not
                trying to optimise them through next/image. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={h.previewUrl} alt="" className="w-full h-16 object-cover" />
          </a>
        ))}
        {loading && <div className="opacity-60 col-span-3 py-4 text-center">searching…</div>}
        {!loading && hits.length === 0 && q.trim() && (
          <div className="opacity-50 col-span-3 py-2 text-center">No results. Try a different query.</div>
        )}
      </div>
    </div>
  );
}
