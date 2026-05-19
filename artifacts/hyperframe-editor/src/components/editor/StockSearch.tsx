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
      <div className="text-[10px] uppercase tracking-wider opacity-60">Stock search</div>

      {/* Provider + kind selects — stack on very narrow, row on wider */}
      <div className="flex gap-1">
        <select
          value={provider}
          onChange={(e) => setProvider(e.target.value as "pixabay" | "unsplash")}
          className="flex-1 rounded bg-ink/60 border border-muted/40 px-2 py-2 text-xs"
        >
          <option value="pixabay">Pixabay</option>
          <option value="unsplash">Unsplash</option>
        </select>
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value as "image" | "video")}
          className="flex-1 rounded bg-ink/60 border border-muted/40 px-2 py-2 text-xs"
        >
          <option value="image">Image</option>
          <option value="video">Video</option>
        </select>
      </div>

      {/* Search input row */}
      <div className="flex gap-1">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void search()}
          placeholder="Search stock…"
          className="flex-1 min-w-0 rounded bg-ink/60 border border-muted/40 px-2 py-2"
        />
        <button
          onClick={() => void search()}
          disabled={loading || !q.trim()}
          className="rounded bg-accent text-ink px-3 py-2 font-semibold disabled:opacity-50 shrink-0"
        >
          {loading ? "…" : "Go"}
        </button>
      </div>

      {missingKey && (
        <div className="opacity-60 italic leading-snug">
          API key not configured for {provider}. Set{" "}
          {provider === "pixabay" ? "PIXABAY_API_KEY" : "UNSPLASH_ACCESS_KEY"} to enable.
        </div>
      )}

      {/* Results grid — 2 cols so images are tap-friendly */}
      {hits.length > 0 && (
        <div className="grid grid-cols-2 gap-1.5">
          {hits.map((hit) => (
            <div key={hit.id} className="flex flex-col gap-0.5">
              <img
                src={hit.previewUrl}
                alt={`${hit.kind} from ${hit.provider}`}
                className="w-full aspect-square object-cover rounded border border-muted/30"
                loading="lazy"
              />
              <a
                href={hit.downloadUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="block text-center py-1 rounded bg-muted/20 hover:bg-muted/40 text-[10px] text-paper/80 transition-colors"
              >
                Open ↗
              </a>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
