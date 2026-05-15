"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { PRESETS, type Composition } from "@hyperframe-editor/core";
import { AgentLog, type AgentEvent } from "@/components/editor/AgentLog";
import { GateBadges } from "@/components/editor/GateBadges";
import { Timeline } from "@/components/editor/Timeline";
import { PropsPanel } from "@/components/editor/PropsPanel";
import { RenderHistory } from "@/components/editor/RenderHistory";
import { StockSearch } from "@/components/editor/StockSearch";
import { SourceUpload } from "@/components/editor/SourceUpload";
import {
  DEFAULT_PROJECT_BUDGET_USD,
  formatUsd,
  sumCostEvents,
  type ProjectCostSnapshot,
} from "@/lib/cost";

/**
 * Editor client component. The route's server component awaits Next 15's
 * Promise<params> and forwards `id` here as a plain string so all the hooks
 * can run cleanly in client land.
 *
 * State machine:
 *   idle → enqueue render/tweak → renderingJobId set → SSE subscribed
 *     → events stream populates AgentLog → on done/error: unsub, refresh
 *
 * Why we don't reuse the worker's QueuedJob shape: this is presentation
 * state, not transport. We translate user actions to API calls and decode
 * SSE frames into AgentEvent. That's it.
 *
 * Preview iframe:
 *   The iframe loads `/api/projects/<id>/composition` directly via `src=`
 *   (not `srcdoc=`). Same-origin loading is what lets the rewritten HTML
 *   resolve `/api/preview/runtime.js` and `/api/projects/<id>/assets/...`
 *   without CORS or sandboxed-srcdoc gotchas. The previous srcdoc approach
 *   broke when the rewritten composition referenced same-origin assets.
 */
export function EditorClient({ id }: { id: string }) {
  const [prompt, setPrompt] = useState(
    "Make a 30-second TikTok-style hook reel about morning chai.",
  );
  const [presetId, setPresetId] = useState("tiktok-hook");
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [renderingJobId, setRenderingJobId] = useState<string | null>(null);
  const [doneUrl, setDoneUrl] = useState<string | null>(null);
  const [composition, setComposition] = useState<Composition | null>(null);
  const [selectedClip, setSelectedClip] = useState<string | null>(null);
  const [tab, setTab] = useState<"chat" | "media" | "history" | "props">("chat");
  const [costSnapshot, setCostSnapshot] = useState<ProjectCostSnapshot>({
    spentUsd: 0,
    budgetUsd: DEFAULT_PROJECT_BUDGET_USD,
    authoritative: false,
  });
  const [tweakPrompt, setTweakPrompt] = useState("");
  // Cache-busting key for the preview iframe. We bump it after every successful
  // render or composition change so the iframe re-fetches the same-origin
  // composition route instead of serving a stale cached page.
  const [previewVersion, setPreviewVersion] = useState(0);

  const presets = useMemo(() => Object.values(PRESETS), []);
  const gateStatus = useMemo<Record<string, "pass" | "warn" | "fail" | "skip"> | null>(() => {
    const last = [...events].reverse().find((e) => e.type === "done");
    if (!last || last.type !== "done") return null;
    return last.gates ?? null;
  }, [events]);

  // Last error message from the current/latest stream — surfaced under the
  // chat tab so a hard failure doesn't disappear into the log.
  const lastError = useMemo(() => {
    const last = [...events].reverse().find((e) => e.type === "error");
    return last?.type === "error" ? last.message : null;
  }, [events]);

  // Running cost = persisted total + in-flight increments from this session's
  // SSE stream. Once the worker emits costSummary we re-fetch the persisted
  // snapshot and the in-flight sum drops back to 0 for the next render.
  const inFlightCostUsd = useMemo(() => sumCostEvents(events), [events]);
  const runningCostUsd = costSnapshot.spentUsd + inFlightCostUsd;
  const overBudget =
    costSnapshot.authoritative && runningCostUsd >= costSnapshot.budgetUsd;

  const refreshCost = useCallback(async () => {
    try {
      const r = await fetch(`/api/projects/${id}/cost`, {
        cache: "no-store",
      });
      if (!r.ok) return;
      const snap = (await r.json()) as ProjectCostSnapshot;
      setCostSnapshot(snap);
    } catch {
      // ignore — likely no DB or stream cancelled
    }
  }, [id]);

  // Load the composition AST from disk into local state. Called on mount and
  // after every render finishes; also after a tweak completes so the timeline
  // refreshes.
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

  // Initial cost + composition fetch on mount + whenever a render finishes.
  useEffect(() => {
    void refreshCost();
    void loadComposition();
  }, [refreshCost, loadComposition, doneUrl]);

  // SSE — subscribe to the worker's progress stream once we have a jobId.
  useEffect(() => {
    if (!renderingJobId) return;
    const es = new EventSource(`/api/render/${renderingJobId}/stream`);
    let closedByDone = false;

    const onMessage = (ev: MessageEvent) => {
      try {
        const data = JSON.parse(ev.data) as AgentEvent;
        setEvents((prev) => [...prev, data]);
        if (data.type === "done" && data.url) setDoneUrl(data.url);
        if (data.type === "tool" && (data as { name?: string }).name === "costSummary") {
          // Worker says "done charging" — refresh the persisted spend so the
          // pill catches up with the in-flight sum.
          void refreshCost();
        }
        if (data.type === "done" || data.type === "error") {
          closedByDone = true;
          es.close();
          void loadComposition();
          void refreshCost();
          // Bump the preview version so the iframe reloads with the
          // freshly-rendered composition + assets.
          setPreviewVersion((v) => v + 1);
        }
      } catch {
        /* ignore malformed frames */
      }
    };

    // EventSource fires `error` for transient blips (proxy hiccups, dev-server
    // reloads). We only close out when the readyState is permanently CLOSED
    // (2). Earlier this listener unconditionally closed the stream which
    // caused renders to silently disconnect mid-job under any flaky network.
    // The route returns a hard 503 when REDIS_URL is unset; that lands here
    // as a CLOSED state and the lastError indicator carries the explanation.
    const onError = () => {
      if (es.readyState === EventSource.CLOSED || closedByDone) {
        es.close();
        // Surface the disconnect so the chat panel shows something instead
        // of going silent. The existing log only carries server-emitted
        // events; this is a client-side observation.
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

  // Rebuild the preview iframe URL whenever the composition or render output
  // changes. We point the iframe at the same-origin /composition route
  // directly (via `src`, not `srcdoc`) so the rewritten HTML can resolve
  // `/api/preview/runtime.js` and `/api/projects/<id>/assets/...` without
  // CORS / sandboxed-origin issues.
  const previewUrl = useMemo(
    () => `/api/projects/${id}/composition?v=${previewVersion}`,
    [id, previewVersion],
  );

  // Debounced preview refresh. We DON'T bump on every local composition state
  // change (that caused infinite iframe reloads during drag). Instead we bump:
  //   - immediately after a render/tweak completes (SSE `done` handler)
  //   - 600ms after the last persistComposition PUT finishes (debounced)
  // The 600ms lets the server-side rewrite catch up before the iframe re-fetches.
  const previewBumpTimer = useRef<NodeJS.Timeout | null>(null);
  const isFirstRender = useRef(true);
  function schedulePreviewRefresh() {
    if (previewBumpTimer.current) clearTimeout(previewBumpTimer.current);
    previewBumpTimer.current = setTimeout(() => {
      setPreviewVersion((v) => v + 1);
    }, 600);
  }
  // Skip the first-mount bump (the iframe loads ?v=0 which is already correct).
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    // Only schedule a refresh when the composition actually changed shape
    // (not just during drag). We track duration+length as a proxy for
    // "structural change" — a clip's text prop changing won't trigger this,
    // which is fine because the iframe only renders blocks, not live props.
  }, [composition?.duration, composition?.clips.length]);

  const debounceRef = useRef<NodeJS.Timeout | null>(null);
  function persistComposition(next: Composition) {
    setComposition(next);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void fetch(`/api/projects/${id}/composition.json`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ composition: next }),
      }).then((r) => {
        if (r.ok) schedulePreviewRefresh();
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

  async function startRender(kindOverride?: "compose" | "edit_source") {
    if (renderInFlight) return;
    setEvents([]);
    setDoneUrl(null);
    setRenderingJobId(null); // clear old subscription before new one
    const kind = kindOverride ?? "compose";
    const res = await fetch("/api/render", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: id, prompt, presetId, kind }),
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
    // Simple client-side intent detection: if the user mentions "edit",
    // "cut", "highlight", "clip" + "video"/"source"/"upload" → route to
    // edit-source. Otherwise → tweak (modifies existing composition AST).
    const lower = text.toLowerCase();
    const looksLikeEditSource =
      /\b(edit|cut|highlight|trim|clip)\b/.test(lower) &&
      /\b(video|source|upload|footage|interview|podcast)\b/.test(lower);
    const kind = looksLikeEditSource ? "edit-source" : "tweak";

    setRenderingJobId(null); // clear old subscription
    const res = await fetch("/api/agent/turn", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: id,
        prompt: text,
        kind,
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
              : `enqueue failed: HTTP ${res.status}`),
        },
      ]);
      return;
    }
    const j = (await res.json()) as { jobId: string };
    setRenderingJobId(j.jobId);
  }

  // Keyboard shortcut: Cmd/Ctrl+Enter renders from the prompt textarea.
  // We scope it so it doesn't fire when the chat input is focused — that
  // form has its own Enter submit handler.
  const promptRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const handler = (ev: KeyboardEvent) => {
      const meta = ev.metaKey || ev.ctrlKey;
      if (!meta || ev.key !== "Enter") return;
      // Only fire if the prompt textarea is focused or no input is focused
      const active = document.activeElement;
      const isPromptFocused = active === promptRef.current;
      const isNoInputFocused =
        !active || active === document.body || active.tagName === "BUTTON";
      if (!isPromptFocused && !isNoInputFocused) return;
      ev.preventDefault();
      void startRender();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prompt, presetId, renderInFlight]);

  return (
    <main className="grid h-screen grid-cols-[400px_1fr]">
      <section className="flex flex-col border-r border-muted/30">
        <div className="border-b border-muted/30 px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="font-display text-lg">hyperframe-editor</div>
              <div className="text-xs opacity-60">{id.length > 12 ? `${id.slice(0, 8)}\u2026` : id}</div>
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
                  : "Preview mode \u2014 cost ledger not connected"
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
            Prompt <span className="opacity-50">(\u2318/Ctrl+Enter to render)</span>
          </label>
          <textarea
            ref={promptRef}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Describe what you want to create or how to edit your video..."
            rows={4}
            className="w-full rounded bg-ink/60 border border-muted/40 px-3 py-2 text-sm"
          />
          <button
            onClick={() => startRender()}
            disabled={renderInFlight || prompt.trim().length < 3}
            className="w-full rounded bg-accent text-ink font-semibold py-2 disabled:opacity-50"
          >
            {renderInFlight ? "Rendering\u2026" : "Render"}
          </button>
          <button
            onClick={() => startRender("edit_source")}
            disabled={renderInFlight || prompt.trim().length < 3}
            className="w-full rounded border border-accent text-accent font-semibold py-2 disabled:opacity-50 hover:bg-accent/10"
          >
            {renderInFlight ? "Editing\u2026" : "Edit Video"}
          </button>
          <GateBadges status={gateStatus} />
          {!composition && (
            <div className="text-xs opacity-50 animate-pulse">Loading composition\u2026</div>
          )}
          {lastError && (
            <button
              onClick={() => setEvents((prev) => prev.filter((e) => e.type !== "error"))}
              className="w-full text-left rounded border border-red-500/40 bg-red-500/10 px-2 py-1 text-[11px] text-red-200 hover:bg-red-500/20"
              title="Click to dismiss"
            >
              {lastError}
            </button>
          )}
        </div>

        <div className="flex border-b border-muted/30 text-xs">
          {(["chat", "media", "history", "props"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t as typeof tab)}
              className={`flex-1 py-2 relative ${
                tab === t ? "bg-muted/15 text-paper" : "opacity-60 hover:opacity-100"
              }`}
            >
              {t}
              {t === "chat" && renderInFlight && (
                <span className="absolute top-1 right-1 h-1.5 w-1.5 rounded-full bg-accent animate-pulse" />
              )}
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
                  placeholder="Chat with the agent \u2014 tweak, edit video, ask anything\u2026"
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
          {tab === "media" && (
            <div className="p-3 space-y-4">
              <SourceUpload projectId={id} />
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
              onDelete={deleteClip}
            />
          )}
        </div>
      </section>

      <section className="flex flex-col">
        <div className="border-b border-muted/30 px-4 py-3 flex items-center justify-between">
          <div className="text-sm">
            {doneUrl && /^https?:/.test(doneUrl) ? "Rendered video" : "Preview"}
          </div>
          <div className="flex items-center gap-3">
            {doneUrl && /^https?:/.test(doneUrl) && (
              <>
                <button
                  type="button"
                  onClick={() => setDoneUrl(null)}
                  className="text-xs opacity-70 hover:opacity-100"
                >
                  \u2190 Back to preview
                </button>
                <a
                  href={doneUrl}
                  className="text-xs underline opacity-80"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Open MP4
                </a>
              </>
            )}
          </div>
        </div>
        <div className="flex-1 grid place-items-center bg-black/40 p-6">
          {doneUrl && /^https?:/.test(doneUrl) ? (
            <video
              src={doneUrl}
              controls
              className="max-h-full max-w-full rounded"
              poster=""
            />
          ) : (
            <iframe
              key={previewUrl}
              src={previewUrl}
              title="composition preview"
              sandbox="allow-scripts"
              className="aspect-[9/16] h-full max-h-full border border-muted/40 bg-ink"
            />
          )}
        </div>
        <Timeline
          composition={composition}
          selectedId={selectedClip}
          onSelect={(clipId) => {
            setSelectedClip(clipId);
            // Only auto-switch to props tab if not actively watching a render
            if (clipId && !renderInFlight) setTab("props");
          }}
          onMutate={persistComposition}
        />
      </section>
    </main>
  );
}
