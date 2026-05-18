import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { PRESETS } from "@/lib/presets";

interface ProjectRow {
  id: string;
  title: string;
  preset: string;
  status: string;
  updatedAt?: string;
}

export default function Home() {
  const [, navigate] = useLocation();
  const [projects, setProjects] = useState<ProjectRow[] | null>(null);
  const [title, setTitle] = useState("Untitled project");
  const [preset, setPreset] = useState("youtube-essay");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const presetOptions = Object.values(PRESETS);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const r = await fetch("/api/projects", { cache: "no-store" });
        if (!r.ok) return;
        const j = (await r.json()) as { projects?: ProjectRow[] };
        if (alive) setProjects(j.projects ?? []);
      } catch {
        if (alive) setProjects([]);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  async function createProject() {
    if (creating) return;
    setCreating(true);
    setCreateError(null);
    try {
      const r = await fetch("/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title, preset }),
      });
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        setCreateError(j.error ?? `HTTP ${r.status}`);
        return;
      }
      const j = (await r.json()) as { project?: ProjectRow };
      if (j.project?.id) navigate(`/editor/${j.project.id}`);
    } catch (e) {
      setCreateError((e as Error).message);
    } finally {
      setCreating(false);
    }
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="font-display text-5xl tracking-tight">hyperframe-editor</h1>
      <p className="mt-4 text-lg opacity-80">
        AI-native HyperFrames video editor for full 5-10 minute videos, source edits, motion graphics, captions, B-roll, preview, and render.
      </p>

      <section className="mt-10 rounded border border-muted/40 bg-ink/40 p-4">
        <div className="mb-3 text-xs uppercase tracking-wider opacity-60">
          New project
        </div>
        <div className="flex flex-col gap-2 md:flex-row">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="flex-1 rounded bg-ink/60 border border-muted/40 px-3 py-2 text-sm"
            placeholder="Project title"
          />
          <select
            value={preset}
            onChange={(e) => setPreset(e.target.value)}
            className="rounded bg-ink/60 border border-muted/40 px-3 py-2 text-sm"
          >
            {presetOptions.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
          <button
            onClick={() => void createProject()}
            disabled={creating || title.trim().length < 1}
            className="rounded bg-accent px-4 py-2 font-semibold text-ink disabled:opacity-50"
          >
            {creating ? "Creating…" : "Create"}
          </button>
        </div>
        {createError && (
          <div className="mt-3 rounded border border-red-500/40 bg-red-500/10 px-2 py-1 text-[11px] text-red-200">
            {createError}
          </div>
        )}
      </section>

      <section className="mt-8">
        <div className="mb-2 text-xs uppercase tracking-wider opacity-60">
          Recent projects
        </div>
        {projects === null ? (
          <div className="text-xs opacity-50">Loading…</div>
        ) : projects.length === 0 ? (
          <div className="text-xs opacity-50">
            No projects yet. Create one above to get started.
          </div>
        ) : (
          <ul className="grid gap-2">
            {projects.map((p) => (
              <li key={p.id}>
                <Link
                  href={`/editor/${p.id}`}
                  className="block rounded border border-muted/30 px-3 py-2 hover:bg-muted/10"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{p.title}</span>
                    <span className="text-xs opacity-60">{p.preset}</span>
                  </div>
                  <div className="text-[10px] uppercase tracking-wider opacity-50">
                    {p.status}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <ul className="mt-12 grid gap-3 text-sm opacity-80">
        <li>• Two loops: BUILD (prompt → full video) and EDIT-SOURCE (source video → polished edit)</li>
        <li>• 8 mandatory quality gates run on every render</li>
        <li>• HyperFrames composition is the source of truth</li>
        <li>• Frontend on Replit · workers on Oracle Free Tier (ARM64)</li>
      </ul>
    </main>
  );
}
