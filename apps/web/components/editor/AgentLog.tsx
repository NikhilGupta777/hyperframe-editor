"use client";

import type { ReactNode } from "react";

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
 */
export function AgentLog({ events }: { events: AgentEvent[] }) {
  if (events.length === 0) {
    return <div className="opacity-50">Agent stream appears here.</div>;
  }
  return (
    <div className="space-y-1">
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
        <span className="font-mono">→</span> {e.step}{" "}
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
        progress: {e.pct}%{e.frame ? ` (${e.frame}/${e.total})` : ""}
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
        {tag} {e.id} {e.fix ? `· fix: ${e.fix}` : ""}
      </div>
    );
  }
  if (e.type === "done")
    return <div className="text-emerald-300 font-semibold">done.</div>;
  if (e.type === "error") return <div className="text-red-400">error: {e.message}</div>;
  if (e.type === "tool")
    return (
      <div className="opacity-70">
        tool · <span className="font-mono">{e.name}</span>
      </div>
    );
  return null;
}
