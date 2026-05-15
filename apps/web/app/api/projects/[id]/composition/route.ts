import { NextResponse } from "next/server";
import { z } from "zod";
import { readJson, serverError } from "@/lib/api";
import { getOrBootstrapComposition, saveCompositionHtml } from "@/lib/composition";

export const runtime = "nodejs";

/**
 * GET  /api/projects/:id/composition       returns the current HTML snapshot
 * PUT  /api/projects/:id/composition       saves a fresh HTML snapshot
 *
 * The composition lives in OCI Object Storage (or a process-local cache when
 * STORAGE_BUCKET isn't set). The DB doesn't store HTML; it just keeps metadata.
 *
 * On first visit to a fresh project, the GET handler bootstraps a tiny
 * placeholder composition so the timeline + preview iframe always have
 * something to show before the first Render click.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const { html, bootstrapped } = await getOrBootstrapComposition(id);
    return new Response(html, {
      headers: {
        "content-type": "text/html; charset=utf-8",
        // A tiny header so test/observability tooling can see when bootstrap fired.
        ...(bootstrapped ? { "x-hyperframe-bootstrapped": "1" } : {}),
      },
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
  try {
    await saveCompositionHtml(id, parsed.html);
    return NextResponse.json({
      ok: true,
      persisted: process.env.STORAGE_BUCKET ? "oci" : "ephemeral",
    });
  } catch (e) {
    return serverError(e);
  }
}
