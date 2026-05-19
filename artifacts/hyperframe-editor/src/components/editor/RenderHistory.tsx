import { useEffect, useState } from "react";

interface JobRow {
  id: string;
  kind: string;
  status: string;
  output?: { url?: string };
  gates?: Record<string, { pass: boolean; severity: "block" | "warn" }>;
  createdAt: string;
}

export function RenderHistory({ projectId }: { projectId: string }) {
  const [rows, setRows] = useState<JobRow[]>([]);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      if (!alive) return;
      try {
        const r = await fetch(`/api/projects/${projectId}/jobs`, { cache: "no-store" });
        if (!r.ok) return;
        const j = (await r.json()) as { jobs?: JobRow[] };
        if (alive) setRows(j.jobs ?? []);
      } catch {
        // ignore
      }
    };

    const schedule = () => {
      if (timer) clearTimeout(timer);
      const interval =
        typeof document !== "undefined" && document.hidden ? 30_000 : 5_000;
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
    return (
      <div className="text-xs opacity-50">
        No render history yet. Click Generate to create your first composition.
      </div>
    );
  }

  return (
    <ul className="space-y-2 text-xs">
      {rows.map((r) => (
        <li
          key={r.id}
          className="rounded border border-muted/30 px-3 py-2.5"
        >
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2 min-w-0">
              <span className="font-mono opacity-70 shrink-0">{r.kind}</span>
              <StatusBadge status={r.status} />
            </div>
            {r.output?.url && /^https?:/.test(r.output.url) && (
              <a
                href={r.output.url}
                className="shrink-0 rounded bg-accent/20 border border-accent/40 text-accent px-2 py-1 text-[10px] font-semibold hover:bg-accent/30 transition-colors"
                target="_blank"
                rel="noopener noreferrer"
              >
                Download MP4
              </a>
            )}
          </div>
          <div className="text-[10px] opacity-40 mt-1 font-mono truncate">
            {r.id}
          </div>
        </li>
      ))}
    </ul>
  );
}

function StatusBadge({ status }: { status: string }) {
  const cls =
    status === "succeeded"
      ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40"
      : status === "failed"
        ? "bg-red-500/20 text-red-300 border-red-500/40"
        : status === "running"
          ? "bg-amber-500/20 text-amber-300 border-amber-500/40"
          : "bg-muted/20 text-muted/70 border-muted/40";
  return (
    <span className={`rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wider ${cls}`}>
      {status}
    </span>
  );
}
