import { NextResponse } from "next/server";
import { z } from "zod";
import {
  CompositionSchema,
  type Composition,
} from "@hyperframe-editor/core";
import {
  addClip,
  deleteClip,
  moveClip,
  setTrackOrder,
  trimClip,
} from "@hyperframe-editor/compose";
import { readJson, serverError } from "@/lib/api";
import { getOrBootstrapComposition, saveComposition } from "@/lib/composition";

export const runtime = "nodejs";

/**
 * Composition AST mutations exposed as REST. The editor's timeline calls these
 * on drag/resize/reorder/delete; the agent calls them via tool dispatch.
 *
 *   POST   /api/projects/:id/clips                    add a clip
 *   PATCH  /api/projects/:id/clips                    move/trim/reorder
 *   DELETE /api/projects/:id/clips?clipId=...         remove a clip
 *
 * Mutations all read the current composition (bootstrapping a placeholder if
 * none exists), apply the mutation via the pure tools in
 * @hyperframe-editor/compose, save the new AST AND its rebuilt HTML so the
 * preview iframe stays in sync.
 *
 * Backed by the shared `lib/composition` helper, so storage-or-ephemeral
 * routing matches what the composition.json route uses — there's no
 * "STORAGE_BUCKET required" branch any more.
 */

const Add = z.object({
  start: z.number().nonnegative().optional(),
  trackIndex: z.number().int().nonnegative().optional(),
  clip: z.object({
    id: z.string().optional(),
    kind: z.enum(["video", "image", "audio", "text", "block"]),
    duration: z.number().positive(),
    block: z.string().optional(),
    assetId: z.string().optional(),
    playbackOffset: z.number().nonnegative().optional(),
    props: z.record(z.unknown()).optional(),
  }),
});

const Patch = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("move"),
    clipId: z.string(),
    start: z.number().nonnegative().optional(),
    trackIndex: z.number().int().nonnegative().optional(),
  }),
  z.object({
    op: z.literal("trim"),
    clipId: z.string(),
    duration: z.number().positive().optional(),
    playbackOffset: z.number().nonnegative().optional(),
  }),
  z.object({
    op: z.literal("track-order"),
    trackIndex: z.number().int().nonnegative(),
    orderedClipIds: z.array(z.string()).min(1),
  }),
]);

async function loadComposition(id: string): Promise<Composition> {
  const { composition } = await getOrBootstrapComposition(id);
  return composition;
}

async function persist(id: string, comp: Composition): Promise<Composition> {
  // Validate before saving; saveComposition rebuilds the HTML form.
  const safe = CompositionSchema.parse(comp);
  await saveComposition(id, safe);
  return safe;
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = await readJson(req, Add);
  if (parsed instanceof NextResponse) return parsed;
  try {
    const comp = await loadComposition(id);
    const next = addClip(comp, parsed);
    return NextResponse.json({ composition: await persist(id, next) });
  } catch (e) {
    return serverError(e);
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = await readJson(req, Patch);
  if (parsed instanceof NextResponse) return parsed;
  try {
    const comp = await loadComposition(id);
    let next = comp;
    if (parsed.op === "move") next = moveClip(comp, parsed);
    else if (parsed.op === "trim") next = trimClip(comp, parsed);
    else if (parsed.op === "track-order") next = setTrackOrder(comp, parsed);
    return NextResponse.json({ composition: await persist(id, next) });
  } catch (e) {
    return serverError(e);
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(req.url);
  const clipId = url.searchParams.get("clipId");
  if (!clipId) return NextResponse.json({ error: "clipId required" }, { status: 400 });
  try {
    const comp = await loadComposition(id);
    const next = deleteClip(comp, { clipId });
    return NextResponse.json({ composition: await persist(id, next) });
  } catch (e) {
    return serverError(e);
  }
}
