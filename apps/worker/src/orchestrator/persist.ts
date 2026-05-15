/**
 * Persistence helpers for the orchestrator. Two storage targets:
 *
 *   - Postgres (jobs table): row updates for status, output, gates, error
 *   - Object storage: composition.html + composition.json snapshots per project
 *
 * Errors here log + swallow when DB/storage are unavailable so a worker still
 * functions in "no-cloud" smoke mode (the smoke tests don't need either).
 */
import { type Composition, type Preset, getPreset, TIKTOK_HOOK } from "@hyperframe-editor/core";

interface PersistComposition {
  load(projectId: string): Promise<Composition>;
  save(projectId: string, composition: Composition, html: string): Promise<void>;
}

const inMemory = new Map<string, { composition: Composition; html: string }>();

async function loadFromStorageIfAvailable(projectId: string): Promise<Composition | null> {
  if (!process.env.STORAGE_BUCKET) return null;
  try {
    const { getStorage, paths } = await import("@hyperframe-editor/storage");
    const storage = getStorage();
    const buf = await storage.getObject(paths.composition(projectId).replace(/\.html$/, ".json"));
    return JSON.parse(buf.toString("utf8")) as Composition;
  } catch {
    return null;
  }
}

async function saveToStorageIfAvailable(
  projectId: string,
  composition: Composition,
  html: string,
): Promise<void> {
  if (!process.env.STORAGE_BUCKET) return;
  try {
    const { getStorage, paths } = await import("@hyperframe-editor/storage");
    const storage = getStorage();
    await Promise.all([
      storage.putObject(paths.composition(projectId), html, "text/html; charset=utf-8"),
      storage.putObject(
        paths.composition(projectId).replace(/\.html$/, ".json"),
        JSON.stringify(composition, null, 2),
        "application/json; charset=utf-8",
      ),
    ]);
  } catch (e) {
    console.warn("[persist] storage save failed (continuing):", e);
  }
}

export const persistComposition: PersistComposition = {
  async load(projectId) {
    const fromStorage = await loadFromStorageIfAvailable(projectId);
    if (fromStorage) return fromStorage;
    const cached = inMemory.get(projectId);
    if (cached) return cached.composition;
    throw new Error(`No composition snapshot for project ${projectId}`);
  },
  async save(projectId, composition, html) {
    inMemory.set(projectId, { composition, html });
    await saveToStorageIfAvailable(projectId, composition, html);
  },
};

export async function recordJobStart(jobId: string): Promise<void> {
  if (!process.env.DATABASE_URL) return;
  try {
    const { getDb, jobs } = await import("@hyperframe-editor/db");
    const { eq } = await import("drizzle-orm");
    await getDb()
      .update(jobs)
      .set({ status: "running", startedAt: new Date() })
      .where(eq(jobs.id, jobId));
  } catch (e) {
    console.warn("[persist] recordJobStart failed (continuing):", e);
  }
}

export async function recordJobFinish(
  jobId: string,
  status: "succeeded" | "failed",
  output: unknown,
  gates: unknown,
  error?: string,
): Promise<void> {
  if (!process.env.DATABASE_URL) return;
  try {
    const { getDb, jobs } = await import("@hyperframe-editor/db");
    const { eq } = await import("drizzle-orm");
    await getDb()
      .update(jobs)
      .set({
        status,
        output: output as never,
        gates: gates as never,
        error: error ?? null,
        finishedAt: new Date(),
      })
      .where(eq(jobs.id, jobId));
  } catch (e) {
    console.warn("[persist] recordJobFinish failed (continuing):", e);
  }
}

/**
 * Resolve the preset for a project. Looks up `projects.preset` in the DB when
 * available; falls back to TIKTOK_HOOK in offline / smoke runs. The TWEAK loop
 * uses this to rebuild HTML without re-reading the original render request.
 */
export async function loadProjectPreset(projectId: string): Promise<Preset> {
  if (!process.env.DATABASE_URL) return TIKTOK_HOOK;
  try {
    const { getProject } = await import("@hyperframe-editor/db");
    const p = await getProject(projectId);
    if (!p?.preset) return TIKTOK_HOOK;
    try {
      return getPreset(p.preset);
    } catch {
      return TIKTOK_HOOK;
    }
  } catch (e) {
    console.warn("[persist] loadProjectPreset failed (continuing):", e);
    return TIKTOK_HOOK;
  }
}
