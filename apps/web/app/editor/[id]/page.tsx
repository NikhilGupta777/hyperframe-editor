"use client";

import { useEffect, useMemo, useRef, useState, use } from "react";
import { PRESETS } from "@hyperframe-editor/core";

type Step =
  | { type: "step"; step: string; status: "running" | "succeeded" | "failed" }
  | { type: "log"; level: "info" | "warn" | "error"; msg: string }
  | { type: "tool"; name: string; input?: unknown; output?: unknown }
  | { type: "progress"; pct: number; frame?: number; total?: number }
  | {
      type: "gate";
      id: string;
      pass: boolean;
      severity: "block" | "warn";
      details?: unknown;
      fix?: string;
    }
  | { type: "done"; url?: string; gates?: Record<string, "pass" | "warn" | "fail"> }
  | { type: "error"; message: string };

export default function EditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [prompt, setPrompt] = useState(
    "Make a 30-second TikTok-style hook reel about morning chai.",
  );
  const [presetId, setPresetId] = useState("tiktok-hook");
  const [events, setEvents] = useState<Step[]>([]);
  const [renderingJobId, setRenderingJobId] = useState<string | null>(null);
  const [doneUrl, setDoneUrl] = useState<string | null>(null);
  const previewRef = useRef<HTMLIFrameElement>(null);

  const presets = useMemo(() => Object.values(PRESETS), []);

  useEffect(() => {
    if (!renderingJobId) return;
    const es = new EventSource(`/api/render/${renderingJobId}/stream`);
    const onAny = (ev: MessageEvent) => {
      try {
        const data = JSON.parse(ev.data) as Step;
        setEvents((prev) => [...prev, data]);
        if (data.type === "done" && data.url) setDoneUrl(data.url);
      } catch {
        /* ignore */
      }
    };
    es.addEventListener("message", onAny);
    es.addEventListener("error", () => es.close());
    return () => es.close();
  }, [renderingJobId]);

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
    <main className="grid h-screen grid-cols-[360px_1fr]">
      {/* Left: chat + controls */}
      <section className="flex flex-col border-r border-muted/30">
        <div className="border-b border-muted/30 px-4 py-3">
          <div className="font-display text-lg">hyperframe-editor</div>
          <div className="text-xs opacity-60">project {id}</div>
        </div>
        <div className="space-y-3 p-4">
          <label className="block text-xs uppercase tracking-wider opacity-60">
            Preset
          </label>
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
            rows={5}
            className="w-full rounded bg-ink/60 border border-muted/40 px-3 py-2 text-sm"
          />
          <button
            onClick={startRender}
            disabled={!!renderingJobId && !doneUrl && events.at(-1)?.type !== "error"}
            className="w-full rounded bg-accent text-ink font-semibold py-2 disabled:opacity-50"
          >
            {renderingJobId ? "Rendering…" : "Render"}
          </button>
        </div>
        <div className="flex-1 overflow-auto border-t border-muted/30 p-3 text-xs">
          {events.length === 0 ? (
            <div className="opacity-50">Agent stream appears here.</div>
          ) : (
            events.map((e, i) => <EventRow key={i} e={e} />)
          )}
        </div>
      </section>

      {/* Right: preview / result */}
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
              className="aspect-[9/16] h-full max-h-full border border-muted/40"
              sandbox="allow-scripts"
            />
          )}
        </div>
      </section>
    </main>
  );
}

function EventRow({ e }: { e: Step }) {
  if (e.type === "step")
    return (
      <div className="opacity-80">
        <span className="font-mono">→</span> {e.step} <span className="opacity-60">({e.status})</span>
      </div>
    );
  if (e.type === "log")
    return (
      <div className={e.level === "warn" ? "text-yellow-300" : e.level === "error" ? "text-red-300" : "opacity-70"}>
        {e.msg}
      </div>
    );
  if (e.type === "progress")
    return (
      <div className="opacity-70">
        progress: {e.pct}%{e.frame ? ` (${e.frame}/${e.total})` : ""}
      </div>
    );
  if (e.type === "gate") {
    const tag = e.pass ? "PASS" : e.severity === "warn" ? "WARN" : "FAIL";
    const color = e.pass ? "text-emerald-400" : e.severity === "warn" ? "text-amber-300" : "text-red-400";
    return (
      <div className={color}>
        {tag} {e.id} {e.fix ? `· fix: ${e.fix}` : ""}
      </div>
    );
  }
  if (e.type === "done") return <div className="text-emerald-300 font-semibold">done.</div>;
  if (e.type === "error") return <div className="text-red-400">error: {e.message}</div>;
  if (e.type === "tool")
    return (
      <div className="opacity-70">
        tool · <span className="font-mono">{e.name}</span>
      </div>
    );
  return null;
}
