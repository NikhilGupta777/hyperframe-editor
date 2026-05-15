"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PRESETS } from "@hyperframe-editor/core";

interface ProjectRow {
  id: string;
  title: string;
  preset: string;
  status: string;
  updatedAt?: string;
}

/**
 * Home page. Lists the demo user's projects, lets them open one or create a
 * new one. Falls back to the static "open the demo editor" affordance when no
 * DB is configured (Vercel preview without infra).
 *
 * The "demo" project remains as a deep link for the legacy share URL we've
 * pasted in docs.
 */
export default function Home() {
  const router = useRouter();
  const [projects, setProjects] = useState<ProjectRow[] | null>(null);
  const [title, setTitle] = useState("Untitled project");
  const [preset, setPreset] = useState("tiktok-hook");
  const [creating, setCreating] = useState(false);
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
    try {
      const r = await fetch("/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title, preset }),
      });
      if (!r.ok) return;
      const j = (await r.json()) as { project?: ProjectRow };
      if (j.project?.id) router.push(`/editor/${j.project.id}`);
    } finally {
      setCreating(false);
    }
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="font-display text-5xl tracking-tight">hyperframe-editor</h1>
      <p className="mt-4 text-lg opacity-80">
        AI-native video-editor agent. Prompt, preview, render \u2014 in the browser.
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
            onClick={createProject}
            disabled={creating || title.trim().length < 1}
            className="rounded bg-accent px-4 py-2 font-semibold text-ink disabled:opacity-50"
          >
            {creating ? "Creating\u2026" : "Create"}
          </button>
        </div>
        <div className="mt-3 text-xs opacity-60">
          Or jump straight to the{" "}
          <Link href="/editor/demo" className="underline">
            demo editor
          </Link>
          .
        </div>
      </section>

      <section className="mt-8">
        <div className="mb-2 text-xs uppercase tracking-wider opacity-60">
          Recent projects
        </div>
        {projects === null ? (
          <div className="text-xs opacity-50">Loading\u2026</div>
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
        <li>\u2022 Two loops: BUILD (prompt \u2192 MP4) and EDIT-SOURCE (video \u2192 polished cut)</li>
        <li>\u2022 8 mandatory quality gates run on every render</li>
        <li>\u2022 HyperFrames composition is the source of truth</li>
        <li>\u2022 Frontend on Vercel \u00b7 workers on Oracle Free Tier (ARM64)</li>
      </ul>
    </main>
  );
}
