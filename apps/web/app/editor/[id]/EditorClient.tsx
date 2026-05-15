"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PRESETS, type Composition } from "@hyperframe-editor/core";
import { AgentLog, type AgentEvent } from "@/components/editor/AgentLog";
import { GateBadges } from "@/components/editor/GateBadges";
import { Timeline } from "@/components/editor/Timeline";
import { PropsPanel } from "@/components/editor/PropsPanel";
import { RenderHistory } from "@/components/editor/RenderHistory";
import { StockSearch } from "@/components/editor/StockSearch";
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
  const [tab, setTab] = useState<"chat" | "assets" | "history" | "props">("chat");
  const [costSnapshot, setCostSnapshot] = useState<ProjectCostSnapshot>({
    spentUsd: 0,
    budgetUsd: DEFAULT_PROJECT_BUDGET_USD,
    authoritative: false,
  });
  const previewRef = useRef<HTMLIFrameElement>(null);

  const presets = useMemo(() => Object.values(PRESETS), []);
  const gateStatus = useMemo<Record<string, "pass" | "warn" | "fail" | "skip"> | null>(() => {
    const last = [...events].reverse().find((e) => e.type === "done");
    if (!last || last.type !== "done") return null;
    return last.gates ?? null;
  }, [events]);

  // Running cost = persisted total + in-flight increments from this session's
  // SSE stream. Once the worker emits costSummary we re-fetch the persisted
  // snapshot and the in-flight sum drops back to 0 for the next render.
  const inFlightCostUsd = useMemo(() => sumCostEvents(events), [events]);
  const runningCostUsd = costSnapshot.spentUsd + inFlightCostUsd;

  const refreshCost = useCallback(async () => {
    try {
      const r = await fetch(`/api/projects/${id}/cost`, { cache: "no-store" });
      if (!r.ok) return;
      const snap = (await r.json()) as ProjectCostSnapshot;
      setCostSnapshot(snap);
    } catch {
      // ignore
    }
  }, [id]);

  // Initial cost fetch on mount + whenever a render finishes.
  useEffect(() => {
    void refreshCost();
  }, [refreshCost, doneUrl]);

  // SSE — subscribe to the worker's progress stream once we have a jobId.
  useEffect(() => {
    if (!renderingJobId) return;
    const es = new EventSource(`/api/render/${renderingJobId}/stream`);
    const onAny = (ev: MessageEvent) => {
      try {
        const data = JSON.parse(ev.data) as AgentEvent;
        setEvents((prev) => [...prev, data]);
        if (data.type === "done" && data.url) setDoneUrl(data.url);
        if (
          data.type === "tool" &&
          (data as { name?: string }).name === "costSummary"
        ) {
          // Worker says "I'm done charging" — refresh the persisted spend so
          // the in-flight sum (which we stop adding from now on) is folded in.
          void refreshCost();
        }
        if (data.type === "done") {
          // Refresh composition snapshot + cost after a successful render.
          void loadComposition();
          void refreshCost();
        }
      } catch {
        /* ignore */
      }
    };
    es.addEventListener("message", onAny);
    es.addEventListener("error", () => es.close());
    return () => es.close();
  }, [renderingJobId, refreshCost]);

  const loadComposition = useCallback(async () => {
    try {
      const r = await fetch(`/api/projects/${id}/composition.json`);
      if (!r.ok) return;
      const j = (await r.json()) as { composition?: Composition };
      if (j.composition) setComposition(j.composition);
    } catch {
      // ignore
    }
  }, [id]);

  // Pull composition AST + HTML preview on mount and after every done event.
  useEffect(() => {
    void loadComposition();
  }, [loadComposition, doneUrl]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const r = await fetch(`/api/projects/${id}/composition`);
        if (!r.ok) return;
        const text = await r.text();
        if (alive && previewRef.current) previewRef.current.srcdoc = text;
      } catch {
        // ignore
      }
    })();
    return () => {
      alive = false;
    };
  }, [id, doneUrl]);

  const debounceRef = useRef<NodeJS.Timeout | null>(null);
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

  async function startRender() {
    setEvents([]);
    setDoneUrl(null);
    const res = await fetch("/api/render", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: id, prompt, presetId }),
    });
    const j = (await res.json()) as { jobId: string };
    setRenderingJobId(j.jobId);
  }

  return (
    <main className="grid h-screen grid-cols-[400px_1fr]">
      <section className="flex flex-col border-r border-muted/30">
        <div className="border-b border-muted/30 px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="font-display text-lg">hyperframe-editor</div>
              <div className="text-xs opacity-60">project {id}</div>
            </div>
            <div
              className="rounded border border-muted/40 bg-ink/40 px-2 py-1 text-right text-[10px] leading-tight"
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
            Prompt
          </label>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={4}
            className="w-full rounded bg-ink/60 border border-muted/40 px-3 py-2 text-sm"
          />
          <button
            onClick={startRender}
            disabled={!!renderingJobId && !doneUrl && events.at(-1)?.type !== "error"}
            className="w-full rounded bg-accent text-ink font-semibold py-2 disabled:opacity-50"
          >
            {renderingJobId && !doneUrl && events.at(-1)?.type !== "error"
              ? "Rendering…"
              : "Render"}
          </button>
          <GateBadges status={gateStatus} />
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
            <div className="p-3">
              <AgentLog events={events} />
            </div>
          )}
          {tab === "assets" && (
            <div className="p-3">
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
          <div>Preview</div>
          {doneUrl && (
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
        <div className="flex-1 grid place-items-center bg-black/40 p-6">
          {doneUrl ? (
            <video src={doneUrl} controls className="max-h-full max-w-full" />
          ) : (
            <iframe
              ref={previewRef}
              title="composition preview"
              className="aspect-[9/16] h-full max-h-full border border-muted/40 bg-ink"
              sandbox="allow-scripts"
            />
          )}
        </div>
        <Timeline
          composition={composition}
          selectedId={selectedClip}
          onSelect={(id) => {
            setSelectedClip(id);
            if (id) setTab("props");
          }}
          onMutate={persistComposition}
        />
      </section>
    </main>
  );
}
