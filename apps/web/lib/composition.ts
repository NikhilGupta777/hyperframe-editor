/**
 * Composition bootstrap + storage glue used by the project composition API
 * routes (HTML + JSON).
 *
 * Why this exists:
 *   When a user lands on /editor/<id> for a freshly-created project, the
 *   timeline and preview iframe used to 404 because the worker hadn't run
 *   yet (no compose loop = no composition.html|json on disk). We auto-bootstrap
 *   a tiny "Untitled project — click Render to begin" composition the first
 *   time either route is requested, so the editor always has something to
 *   render before the first Render click.
 *
 * The placeholder respects the project's preset when available (DB lookup),
 * falling back to TIKTOK_HOOK so the offline / unsigned flow still works.
 */
import {
  type Composition,
  TIKTOK_HOOK,
  PRESETS,
  type Preset,
  computeDuration,
} from "@hyperframe-editor/core";
import { buildCompositionHtml } from "@hyperframe-editor/compose";

interface StorageHandles {
  /** Returns the existing composition AST if present, else null. */
  loadJson: () => Promise<Composition | null>;
  /** Returns the existing composition HTML if present, else null. */
  loadHtml: () => Promise<string | null>;
  /** Writes both AST and HTML to the active backend (storage or ephemeral map). */
  save: (composition: Composition, html: string) => Promise<void>;
}

/** In-process cache used when STORAGE_BUCKET isn't configured. */
const ephemeralAst = new Map<string, Composition>();
const ephemeralHtml = new Map<string, string>();

function ephemeralHandles(projectId: string): StorageHandles {
  return {
    loadJson: async () => ephemeralAst.get(projectId) ?? null,
    loadHtml: async () => ephemeralHtml.get(projectId) ?? null,
    save: async (composition, html) => {
      ephemeralAst.set(projectId, composition);
      ephemeralHtml.set(projectId, html);
    },
  };
}

async function ociHandles(projectId: string): Promise<StorageHandles> {
  const { getStorage, paths } = await import("@hyperframe-editor/storage");
  const storage = getStorage();
  const htmlKey = paths.composition(projectId);
  const jsonKey = htmlKey.replace(/\.html$/, ".json");
  return {
    loadJson: async () => {
      try {
        const buf = await storage.getObject(jsonKey);
        return JSON.parse(buf.toString("utf8")) as Composition;
      } catch {
        return null;
      }
    },
    loadHtml: async () => {
      try {
        const buf = await storage.getObject(htmlKey);
        return buf.toString("utf8");
      } catch {
        return null;
      }
    },
    save: async (composition, html) => {
      await Promise.all([
        storage.putObject(htmlKey, html, "text/html; charset=utf-8"),
        storage.putObject(
          jsonKey,
          JSON.stringify(composition, null, 2),
          "application/json; charset=utf-8",
        ),
      ]);
    },
  };
}

async function getHandles(projectId: string): Promise<StorageHandles> {
  if (!process.env.STORAGE_BUCKET) return ephemeralHandles(projectId);
  try {
    return await ociHandles(projectId);
  } catch {
    // Storage import / config failure — degrade gracefully so the editor still
    // works in misconfigured envs. We log a warning then return ephemeral.
    console.warn(`[composition] storage init failed for ${projectId}; using ephemeral cache`);
    return ephemeralHandles(projectId);
  }
}

/**
 * Best-effort preset lookup. Reads `projects.preset` from the DB when available
 * and falls back to TIKTOK_HOOK. Mirrors the worker's loadProjectPreset.
 */
async function resolvePreset(projectId: string): Promise<Preset> {
  if (!process.env.DATABASE_URL) return TIKTOK_HOOK;
  try {
    const { getProject } = await import("@hyperframe-editor/db");
    const project = await getProject(projectId);
    if (!project?.preset) return TIKTOK_HOOK;
    return PRESETS[project.preset] ?? TIKTOK_HOOK;
  } catch {
    return TIKTOK_HOOK;
  }
}

/**
 * Build a tiny, lint-clean composition the editor can preview before any agent
 * run. Two beats — a HookTitle and an EndCard — so the timeline component has
 * something to render and the user understands they can press Render.
 */
function buildPlaceholder(projectId: string, preset: Preset): Composition {
  const hookDuration = 2;
  const endDuration = 2;
  const composition: Composition = {
    id: projectId,
    canvas: preset.canvas,
    duration: 0,
    assets: [],
    variables: { placeholder: true },
    clips: [
      {
        id: "placeholder-hook",
        kind: "block",
        block: "HookTitle",
        trackIndex: 0,
        start: 0,
        duration: hookDuration,
        playbackOffset: 0,
        props: {
          text: "Untitled project",
          subtext: "Click Render to begin",
        },
      },
      {
        id: "placeholder-end",
        kind: "block",
        block: "EndCard",
        trackIndex: 0,
        start: hookDuration,
        duration: endDuration,
        playbackOffset: 0,
        props: { cta: "Render", handle: "@hyperframeeditor" },
      },
    ],
  };
  composition.duration = computeDuration(composition);
  return composition;
}

export interface BootstrappedComposition {
  composition: Composition;
  html: string;
  /** True when this load triggered the placeholder write. */
  bootstrapped: boolean;
}

/**
 * Returns the project's composition (AST + HTML), bootstrapping a placeholder
 * if neither form is on disk yet. Idempotent across requests and routes:
 * once the worker writes a real composition, we use that; otherwise the
 * placeholder is written once and reused.
 */
export async function getOrBootstrapComposition(
  projectId: string,
): Promise<BootstrappedComposition> {
  const handles = await getHandles(projectId);
  const [existingJson, existingHtml] = await Promise.all([
    handles.loadJson(),
    handles.loadHtml(),
  ]);

  if (existingJson && existingHtml) {
    return { composition: existingJson, html: existingHtml, bootstrapped: false };
  }

  // If only one form exists, rebuild the missing one rather than overwriting
  // the worker's output. This handles the (rare) case where the worker wrote
  // the AST but the HTML save failed mid-flight.
  if (existingJson && !existingHtml) {
    const preset = await resolvePreset(projectId);
    const html = buildCompositionHtml({ preset, composition: existingJson });
    await handles.save(existingJson, html).catch(() => undefined);
    return { composition: existingJson, html, bootstrapped: false };
  }
  if (!existingJson && existingHtml) {
    // We can't safely re-derive the AST from HTML; fall through to bootstrap
    // a fresh placeholder pair. The HTML will be replaced.
  }

  const preset = await resolvePreset(projectId);
  const composition = buildPlaceholder(projectId, preset);
  const html = buildCompositionHtml({ preset, composition });
  await handles.save(composition, html).catch((err) => {
    console.warn(`[composition] save placeholder failed for ${projectId}`, err);
  });
  return { composition, html, bootstrapped: true };
}

/** Persist an updated AST + freshly-built HTML for a project. */
export async function saveComposition(
  projectId: string,
  composition: Composition,
): Promise<{ html: string }> {
  const handles = await getHandles(projectId);
  const preset = await resolvePreset(projectId);
  const html = buildCompositionHtml({ preset, composition });
  await handles.save(composition, html);
  return { html };
}

/** Persist a raw HTML snapshot. Used by /api/projects/:id/composition PUT. */
export async function saveCompositionHtml(projectId: string, html: string): Promise<void> {
  const handles = await getHandles(projectId);
  // We don't have an AST here; preserve any existing one so the JSON form
  // doesn't go stale relative to the new HTML. If none exists, we bootstrap.
  const existing = (await handles.loadJson()) ?? (await getOrBootstrapComposition(projectId)).composition;
  await handles.save(existing, html);
}
