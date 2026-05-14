import { NextResponse } from "next/server";
import { z } from "zod";
import { notFound, readJson, serverError } from "@/lib/api";

export const runtime = "nodejs";

/**
 * GET  /api/projects/:id/composition       returns the current HTML snapshot
 * PUT  /api/projects/:id/composition       saves a fresh HTML snapshot
 *
 * The composition lives in OCI Object Storage (or a local ephemeral cache when
 * STORAGE_BUCKET isn't set). The DB doesn't store HTML; it just keeps metadata.
 */
const ephemeral = new Map<string, string>();

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!process.env.STORAGE_BUCKET) {
    const html = ephemeral.get(id);
    if (!html) return notFound("composition");
    return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
  }
  try {
    const { getStorage, paths } = await import("@hyperframe-editor/storage");
    const storage = getStorage();
    const buf = await storage.getObject(paths.composition(id));
    return new Response(new Uint8Array(buf), {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  } catch (e) {
    return serverError(e);
  }
}

const PutBody = z.object({ html: z.string().min(1) });

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = await readJson(req, PutBody);
  if (parsed instanceof NextResponse) return parsed;
  if (!process.env.STORAGE_BUCKET) {
    ephemeral.set(id, parsed.html);
    return NextResponse.json({ ok: true, persisted: "ephemeral" });
  }
  try {
    const { getStorage, paths } = await import("@hyperframe-editor/storage");
    const storage = getStorage();
    await storage.putObject(paths.composition(id), parsed.html, "text/html; charset=utf-8");
    return NextResponse.json({ ok: true, persisted: "oci" });
  } catch (e) {
    return serverError(e);
  }
}
