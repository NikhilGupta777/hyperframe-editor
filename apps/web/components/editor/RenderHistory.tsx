"use client";

import { useEffect, useState } from "react";

interface JobRow {
  id: string;
  kind: string;
  status: string;
  output?: { url?: string };
  gates?: Record<string, { pass: boolean; severity: "block" | "warn" }>;
  createdAt: string;
}

/**
 * Render history panel. Polls /api/projects/:id/jobs every 5s while the user is
 * looking at it. We keep the UI dumb on purpose; live progress is handled by
 * SSE in the AgentLog, this view is the "what happened in the past" surface.
 *
 * NOTE: /api/projects/:id/jobs hasn't been wired yet — when DATABASE_URL is
 * absent we render an empty state.
 */
export function RenderHistory({ projectId }: { projectId: string }) {
  const [rows, setRows] = useState<JobRow[]>([]);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const r = await fetch(`/api/projects/${projectId}/jobs`);
        if (!r.ok) return;
        const j = (await r.json()) as { jobs?: JobRow[] };
        if (alive) setRows(j.jobs ?? []);
      } catch {
        // ignore — DB may not be configured
      }
    };
    void tick();
    const id = setInterval(tick, 5000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [projectId]);

  if (rows.length === 0) {
    return <div className="text-xs opacity-50">No render history yet.</div>;
  }
  return (
    <ul className="space-y-1 text-xs">
      {rows.map((r) => (
        <li
          key={r.id}
          className="rounded border border-muted/30 px-2 py-1 flex items-center justify-between"
        >
          <span>
            <span className="font-mono opacity-70">{r.kind}</span>{" "}
            <Status status={r.status} />
          </span>
          {r.output?.url && (
            <a
              href={r.output.url}
              className="underline opacity-80"
              target="_blank"
              rel="noopener noreferrer"
            >
              MP4
            </a>
          )}
        </li>
      ))}
    </ul>
  );
}

function Status({ status }: { status: string }) {
  const cls =
    status === "succeeded"
      ? "text-emerald-300"
      : status === "failed"
        ? "text-red-300"
        : status === "running"
          ? "text-amber-200"
          : "opacity-70";
  return <span className={cls}>{status}</span>;
}
