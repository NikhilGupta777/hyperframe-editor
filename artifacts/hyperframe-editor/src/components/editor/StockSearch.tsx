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
          onKeyDown={(e) => e.key === "Enter" && void search()}
          placeholder="search stock…"
          className="flex-1 rounded bg-ink/60 border border-muted/40 px-2 py-1"
        />
        <button
          onClick={() => void search()}
          className="rounded bg-accent text-ink px-2 py-1 font-semibold"
        >
          go
        </button>
      </div>
      {missingKey && (
        <div className="opacity-60 italic">
          API key not configured for {provider}. Set {provider === "pixabay" ? "PIXABAY_API_KEY" : "UNSPLASH_ACCESS_KEY"} to enable.
        </div>
      )}
      {loading && <div className="opacity-50">searching…</div>}
      {hits.length > 0 && (
        <div className="grid grid-cols-3 gap-1">
          {hits.map((hit) => (
            <div key={hit.id} className="relative group">
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
                className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 flex items-center justify-center text-[10px] text-white transition-opacity rounded"
              >
                open
              </a>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
