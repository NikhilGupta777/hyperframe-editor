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
    "Edit this 5-10 minute video with strong pacing, clean captions, relevant B-roll, motion graphics, music, and a polished intro/outro. Keep the full story unless I ask for a short.",
  );
  const [presetId, setPresetId] = useState("youtube-essay");
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [renderingJobId, setRenderingJobId] = useState<string | null>(null);
  const [doneUrl, setDoneUrl] = useState<string | null>(null);
  const [composition, setComposition] = useState<Composition | null>(null);
  const [selectedClip, setSelectedClip] = useState<string | null>(null);
  const [tab, setTab] = useState<"chat" | "assets" | "history" | "props">("chat");
  const [costSnapshot, setCostSnapshot] = useState<ProjectCostSnapshot>({
    spentUsd: 0,
    budgetUsd: DEFAULT_PROJECT_BUDGET_USD,
    authoritative: false,
  });
  const [tweakPrompt, setTweakPrompt] = useState("");
  const [previewVersion, setPreviewVersion] = useState(0);

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
  const overBudget =
    costSnapshot.authoritative && runningCostUsd >= costSnapshot.budgetUsd;

  const refreshCost = useCallback(async () => {
    const ac = new AbortController();
    try {
      const r = await fetch(`/api/projects/${id}/cost`, {
        cache: "no-store",
        signal: ac.signal,
      });
      if (!r.ok) return;
      const snap = (await r.json()) as ProjectCostSnapshot;
      setCostSnapshot(snap);
    } catch {
      // ignore
    }
  }, [id]);

  const loadComposition = useCallback(async () => {
    try {
      const r = await fetch(`/api/projects/${id}/composition.json`, {
        cache: "no-store",
      });
      if (!r.ok) return;
      const j = (await r.json()) as { composition?: Composition };
      if (j.composition) setComposition(j.composition);
    } catch {
      // ignore
    }
  }, [id]);

  useEffect(() => {
    void refreshCost();
    void loadComposition();
  }, [refreshCost, loadComposition, doneUrl]);

  useEffect(() => {
    if (!renderingJobId) return;
    const es = new EventSource(`/api/render/${renderingJobId}/stream`);
    let closedByDone = false;

    const onMessage = (ev: MessageEvent) => {
      try {
        const data = JSON.parse(ev.data as string) as AgentEvent;
        setEvents((prev) => [...prev, data]);
        if (data.type === "done" && data.url) setDoneUrl(data.url);
        if (data.type === "tool" && (data as { name?: string }).name === "costSummary") {
          void refreshCost();
        }
        if (data.type === "done" || data.type === "error") {
          closedByDone = true;
          es.close();
          void loadComposition();
          void refreshCost();
          setPreviewVersion((v) => v + 1);
        }
      } catch {
        /* ignore malformed frames */
      }
    };

    const onError = () => {
      if (es.readyState === EventSource.CLOSED || closedByDone) {
        es.close();
        setEvents((prev) => {
          const last = prev[prev.length - 1];
          if (last && last.type === "error") return prev;
          if (closedByDone) return prev;
          return [
            ...prev,
            {
              type: "error",
              message:
                "stream closed unexpectedly. Verify the worker is running and REDIS_URL is configured.",
            },
          ];
        });
      }
    };

    es.addEventListener("message", onMessage);
    es.addEventListener("error", onError);

    return () => {
      es.close();
    };
  }, [renderingJobId, refreshCost, loadComposition]);

  const previewUrl = useMemo(
    () => `/api/projects/${id}/composition?v=${previewVersion}`,
    [id, previewVersion],
  );

  useEffect(() => {
    if (!composition) return;
    setPreviewVersion((v) => v + 1);
  }, [composition?.duration, composition?.clips.length]);

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
    next.duration = next.clips.reduce(
      (m, c) => Math.max(m, c.start + c.duration),
      0,
    );
    persistComposition(next);
    if (selectedClip === clipId) setSelectedClip(null);
  }

  const renderInFlight = !!renderingJobId && !doneUrl && !lastError;

  async function startRender() {
    if (renderInFlight) return;
    setEvents([]);
    setDoneUrl(null);
    const res = await fetch("/api/render", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: id, prompt, presetId }),
    });
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      setEvents([
        {
          type: "error",
          message:
            j.error ??
            (res.status === 503
              ? "Render queue not configured (REDIS_URL missing)"
              : `enqueue failed: HTTP ${res.status}`),
        },
      ]);
      return;
    }
    const j = (await res.json()) as { jobId: string };
    setRenderingJobId(j.jobId);
  }

  async function startTweak() {
    const text = tweakPrompt.trim();
    if (!text || renderInFlight) return;
    setTweakPrompt("");
    setEvents((prev) => [
      ...prev,
      { type: "log", level: "info", msg: `you: ${text}` },
    ]);
    const res = await fetch("/api/agent/turn", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: id,
        prompt: text,
        kind: "tweak",
        presetId,
      }),
    });
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      setEvents((prev) => [
        ...prev,
        {
          type: "error",
          message:
            j.error ??
            (res.status === 503
              ? "Agent queue not configured (REDIS_URL missing)"
              : `tweak enqueue failed: HTTP ${res.status}`),
        },
      ]);
      return;
    }
    const j = (await res.json()) as { jobId: string };
    setRenderingJobId(j.jobId);
  }

  async function startEditSource(source: SourceRow) {
    if (renderInFlight || source.kind !== "video") return;
    const durationSec = Number(source.durationSec ?? 600);
    const targetDurationSec = Number.isFinite(durationSec) && durationSec > 0 ? durationSec : 600;
    const direction =
      prompt.trim() ||
      "Edit this full source video with strong pacing, clean captions, relevant B-roll, motion graphics, music, and a polished intro/outro.";

    setEvents([
      {
        type: "log",
        level: "info",
        msg: `queued source edit: ${source.storageUri}`,
      },
    ]);
    setDoneUrl(null);

    const res = await fetch("/api/agent/turn", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: id,
        prompt: direction,
        kind: "edit-source",
        presetId,
        sourceUri: source.storageUri,
        targetDurationSec,
        captions: true,
      }),
    });
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      setEvents((prev) => [
        ...prev,
        {
          type: "error",
          message:
            j.error ??
            (res.status === 503
              ? "Agent queue not configured (REDIS_URL missing)"
              : `edit-source enqueue failed: HTTP ${res.status}`),
        },
      ]);
      return;
    }
    const j = (await res.json()) as { jobId: string };
    setRenderingJobId(j.jobId);
    setTab("chat");
  }

  useEffect(() => {
    const handler = (ev: KeyboardEvent) => {
      const meta = ev.metaKey || ev.ctrlKey;
      if (!meta || ev.key !== "Enter") return;
      ev.preventDefault();
      void startRender();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prompt, presetId, renderInFlight]);

  return (
    <main className="grid h-screen grid-cols-[400px_1fr]">
      <section className="flex flex-col border-r border-muted/30 overflow-hidden">
        <div className="border-b border-muted/30 px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="font-display text-lg">hyperframe-editor</div>
              <div className="text-xs opacity-60">project {id}</div>
            </div>
            <div
              className={`rounded border px-2 py-1 text-right text-[10px] leading-tight ${
                overBudget
                  ? "border-red-500/50 bg-red-500/10 text-red-200"
                  : "border-muted/40 bg-ink/40"
              }`}
              title={
                costSnapshot.authoritative
                  ? "Project spend (cost_events ledger)"
                  : "Preview mode — cost ledger not connected"
              }
            >
              <div className="opacity-60 uppercase tracking-wider">Spent</div>
              <div className="font-mono text-paper">
                {formatUsd(runningCostUsd)}
                <span className="opacity-50"> / {formatUsd(costSnapshot.budgetUsd)}</span>
              </div>
              {!costSnapshot.authoritative && (
                <div className="text-[9px] opacity-50">preview</div>
              )}
              {overBudget && <div className="text-[9px] uppercase">over budget</div>}
            </div>
          </div>
        </div>
        <div className="space-y-3 p-4 border-b border-muted/30">
          <label className="block text-xs uppercase tracking-wider opacity-60">Preset</label>
          <select
            value={presetId}
            onChange={(e) => setPresetId(e.target.value)}
            className="w-full rounded bg-ink/60 border border-muted/40 px-3 py-2 text-sm"
          >
            {presets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
          <label className="block text-xs uppercase tracking-wider opacity-60 pt-2">
            Prompt <span className="opacity-50">(⌘/Ctrl+Enter to render)</span>
          </label>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={4}
            className="w-full rounded bg-ink/60 border border-muted/40 px-3 py-2 text-sm"
          />
          <button
            onClick={() => void startRender()}
            disabled={renderInFlight || prompt.trim().length < 3}
            className="w-full rounded bg-accent text-ink font-semibold py-2 disabled:opacity-50"
          >
            {renderInFlight ? "Rendering…" : "Render"}
          </button>
          <GateBadges status={gateStatus} />
          {lastError && (
            <div className="rounded border border-red-500/40 bg-red-500/10 px-2 py-1 text-[11px] text-red-200">
              {lastError}
            </div>
          )}
        </div>

        <div className="flex border-b border-muted/30 text-xs">
          {(["chat", "assets", "history", "props"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 py-2 ${
                tab === t ? "bg-muted/15 text-paper" : "opacity-60 hover:opacity-100"
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-auto">
          {tab === "chat" && (
            <div className="flex h-full flex-col">
              <div className="flex-1 overflow-auto p-3">
                <AgentLog events={events} />
              </div>
              <form
                className="border-t border-muted/30 p-2 flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  void startTweak();
                }}
              >
                <input
                  value={tweakPrompt}
                  onChange={(e) => setTweakPrompt(e.target.value)}
                  placeholder="Ask the agent to tweak the composition…"
                  className="flex-1 rounded bg-ink/60 border border-muted/40 px-2 py-1 text-xs"
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

      <section className="flex flex-col overflow-hidden">
        <div className="border-b border-muted/30 px-4 py-3 flex items-center justify-between">
          <div>Preview</div>
          {doneUrl && /^https?:/.test(doneUrl) && (
            <a
              href={doneUrl}
              className="text-xs underline opacity-80"
              target="_blank"
              rel="noopener noreferrer"
            >
              Open MP4
            </a>
          )}
        </div>
        <div className="flex-1 grid place-items-center bg-black/40 p-6 overflow-hidden">
          {doneUrl && /^https?:/.test(doneUrl) ? (
            <video src={doneUrl} controls className="max-h-full max-w-full" />
          ) : (
            <iframe
              key={previewUrl}
              src={previewUrl}
              title="composition preview"
              className="aspect-[9/16] h-full max-h-full border border-muted/40 bg-ink"
            />
          )}
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
