import { NextResponse } from "next/server";
import { z } from "zod";
import { readJson, serverError } from "@/lib/api";

export const runtime = "nodejs";

const Body = z.object({
  storageUri: z.string().min(1),
  kind: z.enum(["video", "audio", "image", "doc"]),
  durationSec: z.number().nonnegative().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  sha256: z.string().optional(),
});

/**
 * POST /api/projects/:id/sources
 *
 * Called by the browser AFTER it has uploaded bytes via the signed PUT URL.
 * Registers the source in the DB so the agent can reference it.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = await readJson(req, Body);
  if (parsed instanceof NextResponse) return parsed;
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({
      source: { id: crypto.randomUUID(), projectId: id, ...parsed },
    });
  }
  try {
    const { registerSource } = await import("@hyperframe-editor/db");
    const source = await registerSource({
      projectId: id,
      kind: parsed.kind,
      storageUri: parsed.storageUri,
      durationSec: parsed.durationSec !== undefined ? String(parsed.durationSec) : undefined,
      width: parsed.width,
      height: parsed.height,
      sha256: parsed.sha256,
    });
    return NextResponse.json({ source });
  } catch (e) {
    return serverError(e);
  }
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!process.env.DATABASE_URL) return NextResponse.json({ sources: [] });
  try {
    const { listSources } = await import("@hyperframe-editor/db");
    return NextResponse.json({ sources: await listSources(id) });
  } catch (e) {
    return serverError(e);
  }
}
