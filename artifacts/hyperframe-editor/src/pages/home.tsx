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

function ProjectThumb({
  projectId,
  presetId,
}: {
  projectId: string;
  presetId: string;
}) {
  const preset = PRESETS[presetId];
  const ar = preset
    ? `${preset.canvas.width}/${preset.canvas.height}`
    : "16/9";

  return (
    <div
      className="relative overflow-hidden rounded bg-black/60 shrink-0"
      style={{ width: 88, aspectRatio: ar }}
    >
      <iframe
        src={`/api/projects/${projectId}/composition`}
        sandbox="allow-scripts"
        title="preview"
        className="w-full h-full"
        style={{ pointerEvents: "none" }}
      />
      {/* Dim overlay so it reads as a thumbnail, not interactive */}
      <div className="absolute inset-0 bg-black/10" />
    </div>
  );
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
    return () => { alive = false; };
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
    <main className="mx-auto max-w-3xl px-4 sm:px-6 py-10 sm:py-16">
      <h1 className="font-display text-4xl sm:text-5xl tracking-tight">
        hyperframe-editor
      </h1>
      <p className="mt-3 sm:mt-4 text-base sm:text-lg opacity-80 leading-relaxed">
        AI-native HyperFrames video editor. Generate full videos with Gemini,
        edit source footage, add motion graphics, captions, B-roll, and render.
      </p>

      {/* ── Create project ── */}
      <section className="mt-8 rounded border border-muted/40 bg-ink/40 p-4">
        <div className="mb-3 text-xs uppercase tracking-wider opacity-60">
          New project
        </div>
        <div className="flex flex-col gap-2">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void createProject()}
            className="w-full rounded bg-ink/60 border border-muted/40 px-3 py-2.5 text-sm"
            placeholder="Project title"
          />
          <select
            value={preset}
            onChange={(e) => setPreset(e.target.value)}
            className="w-full rounded bg-ink/60 border border-muted/40 px-3 py-2.5 text-sm"
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
            className="w-full rounded bg-accent px-4 py-3 font-semibold text-ink text-sm disabled:opacity-50 transition-opacity"
          >
            {creating ? "Creating…" : "Create"}
          </button>
        </div>
        {createError && (
          <div className="mt-3 rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-[11px] text-red-200 break-words">
            {createError}
          </div>
        )}
      </section>

      {/* ── Recent projects ── */}
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
                  className="flex items-stretch gap-3 rounded border border-muted/30 p-3
                    hover:bg-muted/10 active:bg-muted/15 transition-colors"
                >
                  {/* Composition thumbnail */}
                  <ProjectThumb projectId={p.id} presetId={p.preset} />

                  {/* Project meta */}
                  <div className="flex flex-col justify-center min-w-0 flex-1">
                    <div className="font-medium truncate">{p.title}</div>
                    <div className="text-xs opacity-60 mt-0.5">
                      {PRESETS[p.preset]?.label ?? p.preset}
                    </div>
                    <div className="text-[10px] uppercase tracking-wider opacity-40 mt-1">
                      {p.status}
                    </div>
                  </div>

                  {/* Arrow */}
                  <div className="flex items-center text-muted/50 shrink-0 self-center text-lg">
                    ›
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <ul className="mt-10 sm:mt-12 grid gap-2.5 text-sm opacity-70">
        <li>• Two loops: BUILD (prompt → full video) and EDIT-SOURCE (source video → polished edit)</li>
        <li>• 8 mandatory quality gates run on every render</li>
        <li>• HyperFrames composition is the source of truth</li>
        <li>• Powered by Gemini 3.1 Pro</li>
      </ul>
    </main>
  );
}
