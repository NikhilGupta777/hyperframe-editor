import { NextResponse } from "next/server";
import { z } from "zod";
import { CompositionSchema } from "@hyperframe-editor/core";
import { readJson, serverError } from "@/lib/api";
import { getOrBootstrapComposition, saveComposition } from "@/lib/composition";

export const runtime = "nodejs";

/**
 * GET  /api/projects/:id/composition.json   returns the current Composition AST
 * PUT  /api/projects/:id/composition.json   replaces the AST (validated)
 *
 * The AST is the seam between the worker and the editor UI. The HTML form
 * (composition/route.ts) is for preview iframes and renderers; this JSON form
 * is for the timeline / props panel / agent-driven mutations.
 *
 * On first visit, the GET handler bootstraps a tiny placeholder composition
 * so the timeline component always has something to render before the first
 * Render click. PUT persists a new AST and rebuilds the HTML form so the
 * preview iframe stays in sync without waiting for a render.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const { composition, bootstrapped } = await getOrBootstrapComposition(id);
    return NextResponse.json(
      { composition, bootstrapped },
      {
        headers: bootstrapped ? { "x-hyperframe-bootstrapped": "1" } : {},
      },
    );
  } catch (e) {
    return serverError(e);
  }
}

const PutBody = z.object({ composition: CompositionSchema });

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = await readJson(req, PutBody);
  if (parsed instanceof NextResponse) return parsed;
  try {
    // Re-parse to apply schema defaults (e.g. canvas.fps=30) and pin the output type.
    const composition = CompositionSchema.parse(parsed.composition);
    await saveComposition(id, composition);
    return NextResponse.json({
      ok: true,
      persisted: process.env.STORAGE_BUCKET ? "oci" : "ephemeral",
    });
  } catch (e) {
    return serverError(e);
  }
}
