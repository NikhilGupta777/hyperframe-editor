import { Router, type IRouter } from "express";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { badRequest, notFound, serverError, readJson, DEMO_USER_ID } from "../lib/api-helpers";
import { DEFAULT_PROJECT_BUDGET_USD, type ProjectCostSnapshot } from "../lib/cost";
import {
  getOrBootstrapComposition,
  rewriteHtmlForBrowser,
  saveCompositionHtml,
  saveComposition,
} from "../lib/composition";

const router: IRouter = Router();

// In-memory fallback stores
const ephemeralProjects = new Map<string, ProjectRow>();
const ephemeralSources = new Map<string, SourceRow[]>();

interface ProjectRow {
  id: string;
  userId: string;
  title: string;
  preset: string;
  width: number;
  height: number;
  fps: number;
  durationSec: number;
  storageUri: string;
  budgetUsd: number;
  status: string;
  createdAt: string;
  updatedAt: string;
}

interface SourceRow {
  id: string;
  projectId: string;
  kind: string;
  storageUri: string;
  durationSec?: string | number;
  width?: number;
  height?: number;
  createdAt: string;
}

const PRESETS: Record<string, { id: string; label: string; canvas: { width: number; height: number; fps: number } }> = {
  "youtube-essay":         { id: "youtube-essay",         label: "YouTube Essay",         canvas: { width: 1920, height: 1080, fps: 30 } },
  "tiktok-hook":           { id: "tiktok-hook",           label: "TikTok Hook",           canvas: { width: 1080, height: 1920, fps: 30 } },
  "product-promo":         { id: "product-promo",         label: "Product Promo",         canvas: { width: 1080, height: 1080, fps: 30 } },
  "podcast-clip":          { id: "podcast-clip",          label: "Podcast Clip",          canvas: { width: 1080, height: 1920, fps: 30 } },
  "educational-explainer": { id: "educational-explainer", label: "Educational Explainer", canvas: { width: 1920, height: 1080, fps: 30 } },
  "devotional-reel":       { id: "devotional-reel",       label: "Devotional Reel",       canvas: { width: 1080, height: 1920, fps: 30 } },
};

/** Get the canvas for a project from the presets table, falling back to TikTok 9:16. */
function projectCanvas(projectId: string) {
  const project = ephemeralProjects.get(projectId);
  const preset = project ? (PRESETS[project.preset] ?? PRESETS["tiktok-hook"]!) : PRESETS["tiktok-hook"]!;
  return preset.canvas;
}

// GET /api/projects
router.get("/projects", async (_req, res) => {
  const projects = Array.from(ephemeralProjects.values()).filter(
    (p) => p.userId === DEMO_USER_ID,
  );
  return res.json({ projects });
});

const CreateProjectBody = z.object({
  title: z.string().min(1).max(120),
  preset: z.string().default("youtube-essay"),
});

// POST /api/projects
router.post("/projects", async (req, res) => {
  const parsed = await readJson(req, res, CreateProjectBody);
  if (!parsed) return;

  const presetId = parsed.preset ?? "youtube-essay";
  const preset = PRESETS[presetId] ?? PRESETS["youtube-essay"]!;

  const project: ProjectRow = {
    id: randomUUID(),
    userId: DEMO_USER_ID,
    title: parsed.title,
    preset: preset.id,
    width: preset.canvas.width,
    height: preset.canvas.height,
    fps: preset.canvas.fps,
    durationSec: 0,
    storageUri: `oci://hyperframe-editor/projects/${parsed.title.replace(/\s+/g, "-")}`,
    budgetUsd: 1,
    status: "draft",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  ephemeralProjects.set(project.id, project);
  return res.json({ project });
});

// GET /api/projects/:id
router.get("/projects/:id", async (req, res) => {
  const { id } = req.params;
  if (!id) return badRequest(res, "missing project id");
  const project = ephemeralProjects.get(id);
  if (!project) return notFound(res, "project");
  return res.json({ project });
});

const PatchProjectBody = z.object({
  title: z.string().min(1).max(120).optional(),
  status: z.enum(["draft", "building", "ready", "rendered", "archived"]).optional(),
  budgetUsd: z.number().nonnegative().optional(),
});

// PATCH /api/projects/:id
router.patch("/projects/:id", async (req, res) => {
  const { id } = req.params;
  if (!id) return badRequest(res, "missing project id");
  const parsed = await readJson(req, res, PatchProjectBody);
  if (!parsed) return;
  const project = ephemeralProjects.get(id);
  if (project) {
    if (parsed.title) project.title = parsed.title;
    if (parsed.status) project.status = parsed.status;
    if (parsed.budgetUsd !== undefined) project.budgetUsd = parsed.budgetUsd;
    project.updatedAt = new Date().toISOString();
    ephemeralProjects.set(id, project);
  }
  return res.json({ ok: true });
});

// GET /api/projects/:id/cost
router.get("/projects/:id/cost", async (req, res) => {
  const { id } = req.params;
  if (!id) return badRequest(res, "missing project id");
  void id;
  const snap: ProjectCostSnapshot = {
    spentUsd: 0,
    budgetUsd: DEFAULT_PROJECT_BUDGET_USD,
    authoritative: false,
  };
  return res.json(snap);
});

// GET /api/projects/:id/jobs
router.get("/projects/:id/jobs", async (_req, res) => res.json({ jobs: [] }));

// GET /api/projects/:id/sources
router.get("/projects/:id/sources", async (req, res) => {
  const { id } = req.params;
  if (!id) return badRequest(res, "missing project id");
  return res.json({ sources: ephemeralSources.get(id) ?? [] });
});

const RegisterSourceBody = z.object({
  storageUri: z.string().min(1),
  kind: z.enum(["video", "audio", "image", "doc"]),
  durationSec: z.number().nonnegative().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  sha256: z.string().optional(),
});

// POST /api/projects/:id/sources
router.post("/projects/:id/sources", async (req, res) => {
  const { id } = req.params;
  if (!id) return badRequest(res, "missing project id");
  const parsed = await readJson(req, res, RegisterSourceBody);
  if (!parsed) return;
  const source: SourceRow = {
    id: randomUUID(),
    projectId: id,
    createdAt: new Date().toISOString(),
    ...parsed,
  };
  const existing = ephemeralSources.get(id) ?? [];
  ephemeralSources.set(id, [source, ...existing]);
  return res.json({ source });
});

const UploadUrlBody = z.object({
  filename: z.string().min(1),
  contentType: z.string().min(3),
  sha256: z.string().regex(/^[0-9a-f]{64}$/i).optional(),
});

// POST /api/projects/:id/upload-url
router.post("/projects/:id/upload-url", async (req, res) => {
  const { id } = req.params;
  if (!id) return badRequest(res, "missing project id");
  const parsed = await readJson(req, res, UploadUrlBody);
  if (!parsed) return;
  const safeFilename = parsed.filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  const key = `projects/${id}/sources/${Date.now()}-${safeFilename}`;
  return res.json({
    url: `data:dev,${key}`,
    key,
    contentType: parsed.contentType,
    method: "PUT",
    ttlSec: 0,
    hint: "STORAGE_BUCKET not configured; this is a stub URL.",
  });
});

// GET /api/projects/:id/composition — HTML form for iframe
router.get("/projects/:id/composition", async (req, res) => {
  const { id } = req.params;
  if (!id) return badRequest(res, "missing project id");
  try {
    const canvas = projectCanvas(id);
    const { html: rawHtml, bootstrapped } = await getOrBootstrapComposition(id, canvas);
    const html = rewriteHtmlForBrowser(rawHtml, id);
    if (bootstrapped) res.setHeader("x-hyperframe-bootstrapped", "1");
    res.setHeader("content-type", "text/html; charset=utf-8");
    return res.send(html);
  } catch (e) {
    return serverError(res, e);
  }
});

const PutCompositionHtmlBody = z.object({ html: z.string().min(1) });

// PUT /api/projects/:id/composition
router.put("/projects/:id/composition", async (req, res) => {
  const { id } = req.params;
  if (!id) return badRequest(res, "missing project id");
  const parsed = await readJson(req, res, PutCompositionHtmlBody);
  if (!parsed) return;
  try {
    await saveCompositionHtml(id, parsed.html);
    return res.json({ ok: true, persisted: "ephemeral" });
  } catch (e) {
    return serverError(res, e);
  }
});

// GET /api/projects/:id/composition.json — AST form
router.get("/projects/:id/composition.json", async (req, res) => {
  const { id } = req.params;
  if (!id) return badRequest(res, "missing project id");
  try {
    const canvas = projectCanvas(id);
    const { composition, bootstrapped } = await getOrBootstrapComposition(id, canvas);
    if (bootstrapped) res.setHeader("x-hyperframe-bootstrapped", "1");
    return res.json({ composition, bootstrapped });
  } catch (e) {
    return serverError(res, e);
  }
});

const PutCompositionJsonBody = z.object({
  composition: z.record(z.unknown()),
});

// PUT /api/projects/:id/composition.json
router.put("/projects/:id/composition.json", async (req, res) => {
  const { id } = req.params;
  if (!id) return badRequest(res, "missing project id");
  const parsed = await readJson(req, res, PutCompositionJsonBody);
  if (!parsed) return;
  try {
    // @ts-ignore
    await saveComposition(id, parsed.composition);
    return res.json({ ok: true, persisted: "ephemeral" });
  } catch (e) {
    return serverError(res, e);
  }
});

// GET /api/projects/:id/assets/:name — stub; real impl would stream from OCI
router.get("/projects/:id/assets/:name", async (_req, res) =>
  res.status(404).json({ error: "asset not found (storage not configured)" }),
);

export default router;
