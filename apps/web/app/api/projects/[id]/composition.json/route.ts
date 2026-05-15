import { NextResponse } from "next/server";
import { z } from "zod";
import { CompositionSchema } from "@hyperframe-editor/core";
import { notFound, readJson, serverError } from "@/lib/api";

export const runtime = "nodejs";

/**
 * GET  /api/projects/:id/composition.json   returns the current Composition AST
 * PUT  /api/projects/:id/composition.json   replaces the AST (validated)
 *
 * The AST is the seam between the worker and the editor UI. The HTML form
 * (composition/route.ts) is for preview iframes and renderers; this JSON form
 * is for the timeline / props panel / agent-driven mutations.
 *
 * Storage: oci://bucket/projects/<id>/composition.json when STORAGE_BUCKET is
 * set; otherwise an in-process map keyed by id (good enough for offline preview).
 */
const ephemeral = new Map<string, unknown>();

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!process.env.STORAGE_BUCKET) {
    const raw = ephemeral.get(id);
    if (!raw) return notFound("composition");
    return NextResponse.json({ composition: raw });
  }
  try {
    const { getStorage, paths } = await import("@hyperframe-editor/storage");
    const storage = getStorage();
    const key = paths.composition(id).replace(/\.html$/, ".json");
    const buf = await storage.getObject(key);
    return NextResponse.json({ composition: JSON.parse(buf.toString("utf8")) });
  } catch (e) {
    return serverError(e);
  }
}

const PutBody = z.object({ composition: CompositionSchema });

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = await readJson(req, PutBody);
  if (parsed instanceof NextResponse) return parsed;
  if (!process.env.STORAGE_BUCKET) {
    ephemeral.set(id, parsed.composition);
    return NextResponse.json({ ok: true, persisted: "ephemeral" });
  }
  try {
    const { getStorage, paths } = await import("@hyperframe-editor/storage");
    const storage = getStorage();
    const key = paths.composition(id).replace(/\.html$/, ".json");
    await storage.putObject(
      key,
      JSON.stringify(parsed.composition, null, 2),
      "application/json; charset=utf-8",
    );
    return NextResponse.json({ ok: true, persisted: "oci" });
  } catch (e) {
    return serverError(e);
  }
}
