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
 * Render history panel. Polls /api/projects/:id/jobs every 5s while the user
 * is looking at it AND the tab is visible. We pause when document.hidden flips
 * true so a parked tab doesn't keep banging on the API.
 *
 * Live progress is handled by SSE in the AgentLog; this view is the "what
 * happened in the past" surface, so polling is fine here.
 *
 * NOTE: /api/projects/:id/jobs returns [] when DATABASE_URL is absent so the
 * preview deploy without infra renders an empty state instead of erroring.
 */
export function RenderHistory({ projectId }: { projectId: string }) {
  const [rows, setRows] = useState<JobRow[]>([]);

  useEffect(() => {
    let alive = true;
    let timer: NodeJS.Timeout | null = null;

    const tick = async () => {
      if (!alive) return;
      try {
        const r = await fetch(`/api/projects/${projectId}/jobs`, { cache: "no-store" });
        if (!r.ok) return;
        const j = (await r.json()) as { jobs?: JobRow[] };
        if (alive) setRows(j.jobs ?? []);
      } catch {
        // ignore — DB may not be configured
      }
    };

    const schedule = () => {
      if (timer) clearTimeout(timer);
      // Skip the next tick if the tab is hidden; we'll re-arm when it comes back.
      const interval = typeof document !== "undefined" && document.hidden ? 30_000 : 5_000;
      timer = setTimeout(async () => {
        await tick();
        if (alive) schedule();
      }, interval);
    };

    void tick();
    schedule();

    const onVis = () => {
      if (!document.hidden) void tick();
    };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVis);
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
          {r.output?.url && /^https?:/.test(r.output.url) && (
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
