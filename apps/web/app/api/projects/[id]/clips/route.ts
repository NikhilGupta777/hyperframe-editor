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

export const runtime = "nodejs";

/**
 * Composition AST mutations exposed as REST. The editor's timeline calls these
 * on drag/resize/reorder/delete; the agent calls them via tool dispatch.
 *
 *   POST   /api/projects/:id/clips                    add a clip
 *   PATCH  /api/projects/:id/clips                    move/trim/reorder
 *   DELETE /api/projects/:id/clips?clipId=...         remove a clip
 *
 * Mutations all read the current composition.json, apply the mutation via the
 * pure tools in @hyperframe-editor/compose, and PUT it back. We re-serialise
 * through CompositionSchema so a malformed mutation fails fast.
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

async function loadComposition(id: string): Promise<Composition | null> {
  if (!process.env.STORAGE_BUCKET) return null;
  const { getStorage, paths } = await import("@hyperframe-editor/storage");
  const storage = getStorage();
  const key = paths.composition(id).replace(/\.html$/, ".json");
  const buf = await storage.getObject(key);
  return CompositionSchema.parse(JSON.parse(buf.toString("utf8")));
}

async function saveComposition(id: string, comp: Composition) {
  if (!process.env.STORAGE_BUCKET) return;
  const { getStorage, paths } = await import("@hyperframe-editor/storage");
  const storage = getStorage();
  const key = paths.composition(id).replace(/\.html$/, ".json");
  await storage.putObject(
    key,
    JSON.stringify(comp, null, 2),
    "application/json; charset=utf-8",
  );
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = await readJson(req, Add);
  if (parsed instanceof NextResponse) return parsed;
  try {
    const comp = await loadComposition(id);
    if (!comp) return NextResponse.json({ error: "no composition snapshot" }, { status: 404 });
    const next = addClip(comp, parsed);
    await saveComposition(id, next);
    return NextResponse.json({ composition: next });
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
    if (!comp) return NextResponse.json({ error: "no composition snapshot" }, { status: 404 });
    let next = comp;
    if (parsed.op === "move") next = moveClip(comp, parsed);
    else if (parsed.op === "trim") next = trimClip(comp, parsed);
    else if (parsed.op === "track-order") next = setTrackOrder(comp, parsed);
    await saveComposition(id, next);
    return NextResponse.json({ composition: next });
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
    if (!comp) return NextResponse.json({ error: "no composition snapshot" }, { status: 404 });
    const next = deleteClip(comp, { clipId });
    await saveComposition(id, next);
    return NextResponse.json({ composition: next });
  } catch (e) {
    return serverError(e);
  }
}
