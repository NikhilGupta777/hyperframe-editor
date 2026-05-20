import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import "@hyperframes/player";
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

// ---------------------------------------------------------------------------
// localStorage helpers - persist chat events per project so they survive
// page refreshes and back-navigation.
// ---------------------------------------------------------------------------
function loadStoredEvents(projectId: string): AgentEvent[] {
  try {
    const raw = localStorage.getItem(`hf-events-${projectId}`);
    if (!raw) return [];
    return JSON.parse(raw) as AgentEvent[];
  } catch {
    return [];
  }
}

function saveStoredEvents(projectId: string, events: AgentEvent[]) {
  try {
    // Keep only the last 500 events to avoid ballooning storage
    const trimmed = events.slice(-500);
    localStorage.setItem(`hf-events-${projectId}`, JSON.stringify(trimmed));
  } catch { /* quota exceeded - ignore */ }
}

export default function EditorPage({ id }: { id: string }) {
  const [prompt, setPrompt] = useState(
    "Create a short punchy TikTok-style video about the power of AI in everyday life. Include bold text overlays, dynamic transitions, and upbeat energy.",
  );
  const [presetId, setPresetId] = useState("tiktok-hook");
  const [projectLoaded, setProjectLoaded] = useState(false);
  const [events, setEvents] = useState<AgentEvent[]>(() => loadStoredEvents(id));
  const [activeStreamId, setActiveStreamId] = useState<string | null>(null);
  const [streamDone, setStreamDone] = useState(true);
  const [previewVersion, setPreviewVersion] = useState(0);
  const [composition, setComposition] = useState<Composition | null>(null);
  // True when the composition is still a placeholder (no AI generation yet)
  const [isBootstrapped, setIsBootstrapped] = useState(true);
  const [selectedClip, setSelectedClip] = useState<string | null>(null);
  const [tab, setTab] = useState<"chat" | "assets" | "history" | "props">("chat");
  const [costSnapshot] = useState<ProjectCostSnapshot>({
    spentUsd: 0,
    budgetUsd: DEFAULT_PROJECT_BUDGET_USD,
    authoritative: false,
  });
  const [tweakPrompt, setTweakPrompt] = useState("");
  const [mobileView, setMobileView] = useState<"controls" | "preview">("controls");
  const playerRef = useRef<HTMLElement>(null);

  // ------------------------------------------------------------------
  // Persist events to localStorage whenever they change
  // ------------------------------------------------------------------
  useEffect(() => {
    saveStoredEvents(id, events);
  }, [id, events]);

  // ------------------------------------------------------------------
  // Aspect ratio: use the AI-generated canvas once we have a real
  // composition; otherwise fall back to the project's preset so the
  // placeholder has the correct shape (16:9 for YouTube Essay, etc.)
  // ------------------------------------------------------------------
  const previewAspectRatio = useMemo(() => {
    if (composition?.canvas && !isBootstrapped) {
      return `${composition.canvas.width}/${composition.canvas.height}`;
    }
    const preset = PRESETS[presetId];
    if (preset) return `${preset.canvas.width}/${preset.canvas.height}`;
    return "9/16";
  }, [composition, isBootstrapped, presetId]);

  // Native canvas dimensions for the player's width/height hint attributes
  const previewCanvas = useMemo(() => {
    if (composition?.canvas && !isBootstrapped) return composition.canvas;
    return PRESETS[presetId]?.canvas ?? { width: 1080, height: 1920, fps: 30 };
  }, [composition, isBootstrapped, presetId]);

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

  // ------------------------------------------------------------------
  // Load project details - sets the correct presetId and prompt hint
  // ------------------------------------------------------------------
  useEffect(() => {
    void (async () => {
      try {
        const r = await fetch(`/api/projects/${id}`, { cache: "no-store" });
        if (!r.ok) {
          setProjectLoaded(true);
          return;
        }
        const j = (await r.json()) as { project?: { preset?: string; title?: string } };
        if (j.project?.preset) setPresetId(j.project.preset);
        setProjectLoaded(true);
      } catch {
        setProjectLoaded(true);
      }
    })();
  }, [id]);

  // ------------------------------------------------------------------
  // Load composition AST - also tracks bootstrapped state
  // ------------------------------------------------------------------
  const loadComposition = useCallback(async () => {
    try {
      const r = await fetch(`/api/projects/${id}/composition.json`, { cache: "no-store" });
      if (!r.ok) return;
      const j = (await r.json()) as { composition?: Composition; bootstrapped?: boolean };
      if (j.composition) {
        setComposition(j.composition);
        setIsBootstrapped(j.bootstrapped ?? false);
      }
    } catch { /* ignore */ }
  }, [id]);

  useEffect(() => {
    void loadComposition();
  }, [loadComposition]);

  // ------------------------------------------------------------------
  // SSE stream consumer
  // ------------------------------------------------------------------
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
          setMobileView("preview");
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
    if (renderInFlight || !projectLoaded) return;
    const p = overridePrompt ?? prompt;
    if (!p.trim()) return;

    setEvents((prev) => [
      ...prev,
      { type: "log", level: "info", msg: `> ${kind === "compose" ? "Generating" : "Tweaking"}: ${p.slice(0, 80)}${p.length > 80 ? "..." : ""}` },
    ]);

    try {
      const res = await fetch("/api/gemini/agent/turn", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId: id, prompt: p, kind, presetId }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setEvents((prev) => [...prev, { type: "error", message: j.error ?? `HTTP ${res.status}` }]);
        return;
      }
      const j = (await res.json()) as { turnId: string; jobId: string };
      setActiveStreamId(j.turnId ?? j.jobId);
    } catch (e) {
      setEvents((prev) => [...prev, { type: "error", message: (e as Error).message }]);
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
    setEvents((prev) => [
      ...prev,
      { type: "log", level: "info", msg: `queued source edit: ${source.storageUri}` },
    ]);
    await startGeminiAgent("tweak", `Source video: ${source.storageUri}\n\n${direction}`);
  }

  async function handleExportHtml() {
    const res = await fetch(`/api/projects/${id}/composition`, { cache: "no-store" });
    if (!res.ok) {
      setEvents((prev) => [...prev, { type: "error", message: `Export failed: HTTP ${res.status}` }]);
      return;
    }
    const html = await res.text();
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `hyperframes-${id}.html`;
    a.click();
    URL.revokeObjectURL(url);
    setTab("chat");
    setEvents((prev) => [
      ...prev,
      {
        type: "log",
        level: "info",
        msg: "Exported the current HyperFrames composition HTML. MP4 rendering still needs a render worker.",
      },
    ]);
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
    <main className="flex flex-col h-[100dvh] md:grid md:h-screen md:grid-cols-[400px_1fr] overflow-hidden">

      {/* -- Mobile-only top toggle bar -- */}
      <div className="flex shrink-0 border-b border-muted/30 md:hidden">
        <button
          onClick={() => setMobileView("controls")}
          className={`flex-1 py-3 text-sm font-medium transition-colors ${
            mobileView === "controls" ? "bg-muted/15 text-paper" : "opacity-50"
          }`}
        >
          Controls
        </button>
        <button
          onClick={() => setMobileView("preview")}
          className={`flex-1 py-3 text-sm font-medium transition-colors ${
            mobileView === "preview" ? "bg-muted/15 text-paper" : "opacity-50"
          }`}
        >
          {renderInFlight ? (
            <span className="flex items-center justify-center gap-1.5">
              <span className="inline-block w-2.5 h-2.5 rounded-full border-2 border-accent border-t-transparent animate-spin" />
              Generating...
            </span>
          ) : "Preview"}
        </button>
      </div>

      {/* -- Left sidebar -- */}
      <section
        className={`flex-col border-r border-muted/30 overflow-hidden ${
          mobileView === "controls" ? "flex flex-1" : "hidden md:flex"
        }`}
      >
        {/* Header */}
        <div className="border-b border-muted/30 px-4 py-3 shrink-0">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="font-display text-lg leading-tight">hyperframe-editor</div>
              <div className="text-[11px] opacity-50 font-mono truncate max-w-[180px]">{id}</div>
            </div>
            <div className="rounded border border-muted/40 bg-ink/40 px-2 py-1 text-right text-[10px] leading-tight shrink-0">
              <div className="opacity-60 uppercase tracking-wider">Gemini</div>
              <div className="font-mono text-accent text-[11px]">
                {formatUsd(runningCostUsd)}
              </div>
              <div className="text-[9px] opacity-50">3.1 pro</div>
            </div>
          </div>
        </div>

        {/* Preset + Prompt + Generate */}
        <div className="space-y-2 p-4 border-b border-muted/30 shrink-0">
          <label className="block">
            <span className="block text-[10px] uppercase tracking-wider opacity-60 pb-1">Preset</span>
            <select
              value={presetId}
              onChange={(e) => setPresetId(e.target.value)}
              className="w-full rounded bg-ink/60 border border-muted/40 px-3 py-2 text-sm"
              disabled={renderInFlight || !projectLoaded}
            >
              {presets.map((p) => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="block text-[10px] uppercase tracking-wider opacity-60 pb-1">
              Prompt <span className="opacity-50 hidden sm:inline">(Cmd/Ctrl+Enter to generate)</span>
            </span>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={4}
              className="w-full rounded bg-ink/60 border border-muted/40 px-3 py-2 text-sm resize-none"
              disabled={renderInFlight}
              placeholder="Describe the video you want to create..."
            />
          </label>

          <button
            onClick={() => void startGeminiAgent("compose")}
            disabled={renderInFlight || !projectLoaded || prompt.trim().length < 3}
            className="w-full rounded bg-accent text-ink font-semibold py-3 disabled:opacity-50 transition-opacity flex items-center justify-center gap-2 text-sm"
          >
            {renderInFlight ? (
              <>
                <span className="inline-block w-3 h-3 rounded-full border-2 border-ink border-t-transparent animate-spin" />
                Generating...
              </>
            ) : (
              "* Generate with Gemini"
            )}
          </button>

          <GateBadges status={gateStatus} />

          {lastError && (
            <div className="rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-[11px] text-red-200 leading-relaxed break-words">
              {lastError}
            </div>
          )}
        </div>

        {/* Tabs */}
        <div className="flex border-b border-muted/30 text-xs shrink-0">
          {(["chat", "assets", "history", "props"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 py-2.5 transition-colors ${
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
                className="border-t border-muted/30 p-2 flex gap-2 shrink-0"
                onSubmit={(e) => { e.preventDefault(); void startTweak(); }}
              >
                <input
                  value={tweakPrompt}
                  onChange={(e) => setTweakPrompt(e.target.value)}
                  placeholder="Ask Gemini to tweak the composition..."
                  className="flex-1 rounded bg-ink/60 border border-muted/40 px-3 py-2 text-sm min-w-0"
                  disabled={renderInFlight}
                />
                <button
                  type="submit"
                  disabled={renderInFlight || tweakPrompt.trim().length < 2}
                  className="rounded bg-accent text-ink px-4 py-2 text-sm font-semibold disabled:opacity-50 shrink-0"
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

      {/* -- Right: preview + timeline -- */}
      <section
        className={`flex-col overflow-hidden ${
          mobileView === "preview" ? "flex flex-1" : "hidden md:flex"
        }`}
      >
        <div className="border-b border-muted/30 px-4 py-3 flex items-center justify-between text-sm shrink-0">
          <span className="font-medium">Preview</span>
          <div className="flex items-center gap-2 text-xs">
            {renderInFlight && (
              <span className="text-accent animate-pulse hidden sm:inline">Generating...</span>
            )}
            <button
              onClick={() => setPreviewVersion((v) => v + 1)}
              className="opacity-60 hover:opacity-100 px-2 py-1"
              title="Reload preview"
            >
              Reload
            </button>
            <button
              onClick={handleExportHtml}
              disabled={renderInFlight}
              title="Export composition HTML"
              className="rounded border border-muted/40 bg-ink/60 px-3 py-1.5 font-medium text-[11px] uppercase tracking-wide hover:border-accent/60 hover:text-accent transition-colors disabled:opacity-30"
            >
              Export HTML
            </button>
          </div>
        </div>

        <div className="flex-1 grid place-items-center bg-black/40 p-2 sm:p-4 overflow-hidden min-h-0">
          <div
            className="border border-muted/20 rounded shadow-xl overflow-hidden"
            style={{
              aspectRatio: previewAspectRatio,
              maxHeight: "100%",
              maxWidth: "100%",
              width: "auto",
              height: "100%",
            }}
          >
            <hyperframes-player
              key={previewUrl}
              ref={playerRef}
              src={previewUrl}
              width={previewCanvas.width}
              height={previewCanvas.height}
              autoplay
              muted
              controls
              style={{ width: "100%", height: "100%", display: "block" }}
            />
          </div>
        </div>

        <div className="shrink-0">
          <Timeline
            composition={composition}
            selectedId={selectedClip}
            onSelect={(clipId) => {
              setSelectedClip(clipId);
              if (clipId) {
                setTab("props");
                setMobileView("controls");
              }
            }}
            onMutate={persistComposition}
          />
        </div>
      </section>
    </main>
  );
}
