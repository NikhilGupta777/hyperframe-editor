"use client";

import { useEffect, useRef, type ReactNode } from "react";

export type AgentEvent =
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

/**
 * Reusable agent stream renderer. The editor page used to inline this; pulled
 * out so the future timeline/asset views can also render the same stream.
 *
 * Auto-scrolls to the bottom on new events when the user is already at the
 * bottom — avoids fighting the user when they've scrolled up to read history.
 */
export function AgentLog({ events }: { events: AgentEvent[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (stickToBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [events.length]);

  function onScroll(e: React.UIEvent<HTMLDivElement>) {
    const el = e.currentTarget;
    const distFromBottom = el.scrollHeight - el.clientHeight - el.scrollTop;
    stickToBottomRef.current = distFromBottom < 24;
  }

  if (events.length === 0) {
    return <div className="opacity-50">Agent stream appears here.</div>;
  }
  return (
    <div
      ref={scrollRef}
      onScroll={onScroll}
      className="space-y-1 overflow-auto pr-1"
    >
      {events.map((e, i) => (
        <Row key={i} e={e} />
      ))}
    </div>
  );
}

function Row({ e }: { e: AgentEvent }): ReactNode {
  if (e.type === "step")
    return (
      <div className="opacity-80">
        <span className="font-mono">\u2192</span> {e.step}{" "}
        <span className="opacity-60">({e.status})</span>
      </div>
    );
  if (e.type === "log") {
    const cls =
      e.level === "warn"
        ? "text-yellow-300"
        : e.level === "error"
          ? "text-red-300"
          : "opacity-70";
    return <div className={cls}>{e.msg}</div>;
  }
  if (e.type === "progress")
    return (
      <div className="opacity-70">
        <div className="flex items-center justify-between text-[11px]">
          <span>render</span>
          <span className="font-mono">
            {e.pct}%{e.frame !== undefined && e.total !== undefined ? ` (${e.frame}/${e.total})` : ""}
          </span>
        </div>
        <div className="h-1 rounded bg-muted/30 overflow-hidden">
          <div
            className="h-full bg-accent"
            style={{ width: `${Math.max(0, Math.min(100, e.pct))}%` }}
          />
        </div>
      </div>
    );
  if (e.type === "gate") {
    const tag = e.pass ? "PASS" : e.severity === "warn" ? "WARN" : "FAIL";
    const color = e.pass
      ? "text-emerald-400"
      : e.severity === "warn"
        ? "text-amber-300"
        : "text-red-400";
    return (
      <div className={color}>
        {tag} {e.id} {e.fix ? `\u00b7 fix: ${e.fix}` : ""}
      </div>
    );
  }
  if (e.type === "done")
    return (
      <div className="text-emerald-300 font-semibold">
        done.
        {e.url && (
          <>
            {" "}
            <a
              href={e.url}
              target="_blank"
              rel="noopener noreferrer"
              className="underline opacity-90"
            >
              MP4
            </a>
          </>
        )}
      </div>
    );
  if (e.type === "error") return <div className="text-red-400">error: {e.message}</div>;
  if (e.type === "tool") {
    if (e.name === "cost") {
      const out = e.output as
        | { provider?: string; unit?: string; qty?: number; costUsd?: number }
        | undefined;
      if (out) {
        return (
          <div className="opacity-70">
            cost \u00b7 <span className="font-mono">{out.provider}</span>{" "}
            {out.unit ? <span className="opacity-60">{out.unit}</span> : null}{" "}
            {typeof out.costUsd === "number" ? (
              <span>${out.costUsd.toFixed(6)}</span>
            ) : null}
          </div>
        );
      }
    }
    if (e.name === "costSummary") {
      const out = e.output as { totalUsd?: number } | undefined;
      return (
        <div className="opacity-80">
          cost summary \u00b7{" "}
          <span className="font-mono">${out?.totalUsd?.toFixed(6) ?? "0"}</span>
        </div>
      );
    }
    if (e.name === "asset") {
      const out = e.output as
        | { provider?: string; kind?: string; src?: string; generated?: boolean }
        | undefined;
      return (
        <div className="opacity-70">
          asset \u00b7 <span className="font-mono">{out?.kind}</span>{" "}
          <span className="opacity-60">{out?.provider}</span>{" "}
          <span className="opacity-50">{out?.src}</span>{" "}
          {out?.generated ? <span className="text-amber-300">(generated)</span> : null}
        </div>
      );
    }
    return (
      <div className="opacity-70">
        tool \u00b7 <span className="font-mono">{e.name}</span>
      </div>
    );
  }
  return null;
}
