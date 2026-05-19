import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AgentLog, type AgentEvent } from "@/components/editor/AgentLog";
import { GateBadges } from "@/components/editor/GateBadges";
import { Timeline } from "@/components/editor/Timeline";
import { PropsPanel } from "@/components/editor/PropsPanel";
import { RenderHistory } from "@/components/editor/RenderHistory";
import { StockSearch } from "@/components/editor/StockSearch";
import { SourceUpload, type SourceRow } from "@/components/editor/SourceUpload";
import {
  DEFAULT_PROJECT_BUDGET_USD,
  formatUsd,
  sumCostEvents,
  type ProjectCostSnapshot,
} from "@/lib/cost";
import { PRESETS } from "@/lib/presets";
import type { Composition } from "@/types/composition";

export default function EditorPage({ id }: { id: string }) {
  const [prompt, setPrompt] = useState(
    "Create a short punchy TikTok-style video about the power of AI in everyday life. Include bold text overlays, dynamic transitions, and upbeat energy.",
  );
  const [presetId, setPresetId] = useState("tiktok-hook");
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [activeStreamId, setActiveStreamId] = useState<string | null>(null);
  const [streamDone, setStreamDone] = useState(true);
  const [previewVersion, setPreviewVersion] = useState(0);
  const [composition, setComposition] = useState<Composition | null>(null);
  const [selectedClip, setSelectedClip] = useState<string | null>(null);
  const [tab, setTab] = useState<"chat" | "assets" | "history" | "props">("chat");
  const [costSnapshot] = useState<ProjectCostSnapshot>({
    spentUsd: 0,
    budgetUsd: DEFAULT_PROJECT_BUDGET_USD,
    authoritative: false,
  });
  const [tweakPrompt, setTweakPrompt] = useState("");

  const presets = useMemo(() => Object.values(PRESETS), []);

  const gateStatus = useMemo<Record<string, "pass" | "warn" | "fail" | "skip"> | null>(() => {
    const last = [...events].reverse().find((e) => e.type === "done");
    if (!last || last.type !== "done") return null;
    return last.gates ?? null;
  }, [events]);

  const lastError = useMemo(() => {
    const last = [...events].reverse().find((e) => e.type === "error");
    return last?.type === "error" ? last.message : null;
  }, [events]);

  const inFlightCostUsd = useMemo(() => sumCostEvents(events), [events]);
  const runningCostUsd = costSnapshot.spentUsd + inFlightCostUsd;

  const loadComposition = useCallback(async () => {
    try {
      const r = await fetch(`/api/projects/${id}/composition.json`, { cache: "no-store" });
      if (!r.ok) return;
      const j = (await r.json()) as { composition?: Composition };
      if (j.composition) setComposition(j.composition);
    } catch { /* ignore */ }
  }, [id]);

  useEffect(() => {
    void loadComposition();
  }, [loadComposition]);

  // SSE stream consumer
  useEffect(() => {
    if (!activeStreamId) return;

    setStreamDone(false);
    const es = new EventSource(`/api/gemini/agent/${activeStreamId}/stream`);
    let closedByDone = false;

    const onMessage = (ev: MessageEvent) => {
      try {
        const data = JSON.parse(ev.data as string) as AgentEvent;
        setEvents((prev) => [...prev, data]);
        if (data.type === "done") {
          closedByDone = true;
          es.close();
          setStreamDone(true);
          void loadComposition();
          setPreviewVersion((v) => v + 1);
        }
        if (data.type === "error") {
          closedByDone = true;
          es.close();
          setStreamDone(true);
        }
      } catch { /* ignore malformed frames */ }
    };

    const onError = () => {
      if (es.readyState === EventSource.CLOSED || closedByDone) {
        es.close();
        setStreamDone(true);
        if (!closedByDone) {
          setEvents((prev) => [
            ...prev,
            { type: "error", message: "Stream closed unexpectedly. Check the server logs." },
          ]);
        }
      }
    };

    es.addEventListener("message", onMessage);
    es.addEventListener("error", onError);
    return () => es.close();
  }, [activeStreamId, loadComposition]);

  const previewUrl = useMemo(
    () => `/api/projects/${id}/composition?v=${previewVersion}`,
    [id, previewVersion],
  );

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  function persistComposition(next: Composition) {
    setComposition(next);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void fetch(`/api/projects/${id}/composition.json`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ composition: next }),
      });
    }, 400);
  }

  async function deleteClip(clipId: string) {
    if (!composition) return;
    const next: Composition = JSON.parse(JSON.stringify(composition));
    next.clips = next.clips.filter((c) => c.id !== clipId);
    next.duration = next.clips.reduce((m, c) => Math.max(m, c.start + c.duration), 0);
    persistComposition(next);
    if (selectedClip === clipId) setSelectedClip(null);
  }

  const renderInFlight = !streamDone;

  async function startGeminiAgent(kind: "compose" | "tweak", overridePrompt?: string) {
    if (renderInFlight) return;
    const p = overridePrompt ?? prompt;
    if (!p.trim()) return;

    setEvents([{ type: "log", level: "info", msg: `▶ ${kind === "compose" ? "Rendering" : "Tweaking"}: ${p.slice(0, 80)}${p.length > 80 ? "…" : ""}` }]);

    try {
      const res = await fetch("/api/gemini/agent/turn", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId: id, prompt: p, kind, presetId }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setEvents([{ type: "error", message: j.error ?? `HTTP ${res.status}` }]);
        return;
      }
      const j = (await res.json()) as { turnId: string; jobId: string };
      setActiveStreamId(j.turnId ?? j.jobId);
    } catch (e) {
      setEvents([{ type: "error", message: (e as Error).message }]);
    }
  }

  async function startTweak() {
    const text = tweakPrompt.trim();
    if (!text || renderInFlight) return;
    setTweakPrompt("");
    await startGeminiAgent("tweak", text);
  }

  async function startEditSource(source: SourceRow) {
    if (renderInFlight || source.kind !== "video") return;
    const direction =
      prompt.trim() ||
      "Edit this full source video with strong pacing, clean captions, relevant B-roll, motion graphics, music, and a polished intro/outro.";
    setEvents([{ type: "log", level: "info", msg: `queued source edit: ${source.storageUri}` }]);
    await startGeminiAgent("tweak", `Source video: ${source.storageUri}\n\n${direction}`);
  }

  useEffect(() => {
    const handler = (ev: KeyboardEvent) => {
      if (!(ev.metaKey || ev.ctrlKey) || ev.key !== "Enter") return;
      ev.preventDefault();
      void startGeminiAgent("compose");
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prompt, presetId, renderInFlight]);

  return (
    <main className="grid h-screen grid-cols-[400px_1fr] overflow-hidden">
      {/* ── Left sidebar ── */}
      <section className="flex flex-col border-r border-muted/30 overflow-hidden">
        {/* Header */}
        <div className="border-b border-muted/30 px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="font-display text-lg leading-tight">hyperframe-editor</div>
              <div className="text-[11px] opacity-50 font-mono truncate max-w-[200px]">{id}</div>
            </div>
            <div className="rounded border border-muted/40 bg-ink/40 px-2 py-1 text-right text-[10px] leading-tight shrink-0">
              <div className="opacity-60 uppercase tracking-wider">Gemini</div>
              <div className="font-mono text-accent text-[11px]">
                {formatUsd(runningCostUsd)}
              </div>
              <div className="text-[9px] opacity-50">2.5 flash</div>
            </div>
          </div>
        </div>

        {/* Preset + Prompt + Render */}
        <div className="space-y-2 p-4 border-b border-muted/30">
          <label className="block">
            <span className="block text-[10px] uppercase tracking-wider opacity-60 pb-1">Preset</span>
            <select
              value={presetId}
              onChange={(e) => setPresetId(e.target.value)}
              className="w-full rounded bg-ink/60 border border-muted/40 px-3 py-2 text-sm"
              disabled={renderInFlight}
            >
              {presets.map((p) => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="block text-[10px] uppercase tracking-wider opacity-60 pb-1">
              Prompt <span className="opacity-50">(⌘/Ctrl+Enter to render)</span>
            </span>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={4}
              className="w-full rounded bg-ink/60 border border-muted/40 px-3 py-2 text-sm resize-none"
              disabled={renderInFlight}
              placeholder="Describe the video you want to create…"
            />
          </label>

          <button
            onClick={() => void startGeminiAgent("compose")}
            disabled={renderInFlight || prompt.trim().length < 3}
            className="w-full rounded bg-accent text-ink font-semibold py-2.5 disabled:opacity-50 transition-opacity flex items-center justify-center gap-2"
          >
            {renderInFlight ? (
              <>
                <span className="inline-block w-3 h-3 rounded-full border-2 border-ink border-t-transparent animate-spin" />
                Generating…
              </>
            ) : (
              "✦ Generate with Gemini"
            )}
          </button>

          <GateBadges status={gateStatus} />

          {lastError && (
            <div className="rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-[11px] text-red-200 leading-relaxed">
              {lastError}
            </div>
          )}
        </div>

        {/* Tabs */}
        <div className="flex border-b border-muted/30 text-xs">
          {(["chat", "assets", "history", "props"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 py-2 transition-colors ${
                tab === t ? "bg-muted/15 text-paper font-medium" : "opacity-60 hover:opacity-100"
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-auto min-h-0">
          {tab === "chat" && (
            <div className="flex h-full flex-col min-h-0">
              <div className="flex-1 overflow-auto p-3 min-h-0">
                <AgentLog events={events} />
              </div>
              <form
                className="border-t border-muted/30 p-2 flex gap-2"
                onSubmit={(e) => { e.preventDefault(); void startTweak(); }}
              >
                <input
                  value={tweakPrompt}
                  onChange={(e) => setTweakPrompt(e.target.value)}
                  placeholder="Ask Gemini to tweak the composition…"
                  className="flex-1 rounded bg-ink/60 border border-muted/40 px-2 py-1.5 text-xs"
                  disabled={renderInFlight}
                />
                <button
                  type="submit"
                  disabled={renderInFlight || tweakPrompt.trim().length < 2}
                  className="rounded bg-accent text-ink px-3 py-1 text-xs font-semibold disabled:opacity-50"
                >
                  Send
                </button>
              </form>
            </div>
          )}
          {tab === "assets" && (
            <div className="p-3 space-y-4">
              <SourceUpload
                projectId={id}
                disabled={renderInFlight}
                onEditSource={(s) => void startEditSource(s)}
              />
              <hr className="border-muted/30" />
              <StockSearch />
            </div>
          )}
          {tab === "history" && (
            <div className="p-3">
              <RenderHistory projectId={id} />
            </div>
          )}
          {tab === "props" && (
            <PropsPanel
              composition={composition}
              selectedId={selectedClip}
              onChange={persistComposition}
              onDelete={(clipId) => void deleteClip(clipId)}
            />
          )}
        </div>
      </section>

      {/* ── Right: preview + timeline ── */}
      <section className="flex flex-col overflow-hidden">
        <div className="border-b border-muted/30 px-4 py-3 flex items-center justify-between text-sm">
          <span className="font-medium">Preview</span>
          <div className="flex items-center gap-3 text-xs">
            {renderInFlight && (
              <span className="text-accent animate-pulse">Gemini generating…</span>
            )}
            <button
              onClick={() => setPreviewVersion((v) => v + 1)}
              className="opacity-60 hover:opacity-100"
              title="Reload preview"
            >
              ↺ reload
            </button>
          </div>
        </div>

        <div className="flex-1 grid place-items-center bg-black/40 p-4 overflow-hidden">
          <iframe
            key={previewUrl}
            src={previewUrl}
            title="composition preview"
            sandbox="allow-scripts"
            className="h-full max-h-full border border-muted/20 bg-ink rounded shadow-xl"
            style={{ aspectRatio: presetId.includes("youtube") || presetId.includes("educational") ? "16/9" : "9/16" }}
          />
        </div>

        <Timeline
          composition={composition}
          selectedId={selectedClip}
          onSelect={(clipId) => {
            setSelectedClip(clipId);
            if (clipId) setTab("props");
          }}
          onMutate={persistComposition}
        />
      </section>
    </main>
  );
}
