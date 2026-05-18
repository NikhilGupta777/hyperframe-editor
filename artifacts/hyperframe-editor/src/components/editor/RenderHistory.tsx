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
