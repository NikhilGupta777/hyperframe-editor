import { NextResponse } from "next/server";
import { z } from "zod";
import { notFound, readJson, serverError } from "@/lib/api";

export const runtime = "nodejs";

const PatchBody = z.object({
  title: z.string().min(1).max(120).optional(),
  status: z.enum(["draft", "building", "ready", "rendered", "archived"]).optional(),
  budgetUsd: z.number().nonnegative().optional(),
});

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!process.env.DATABASE_URL) return notFound("project");
  try {
    const { getProject } = await import("@hyperframe-editor/db");
    const project = await getProject(id);
    return project ? NextResponse.json({ project }) : notFound("project");
  } catch (e) {
    return serverError(e);
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = await readJson(req, PatchBody);
  if (parsed instanceof NextResponse) return parsed;
  if (!process.env.DATABASE_URL) return NextResponse.json({ ok: true });
  try {
    const { updateProject } = await import("@hyperframe-editor/db");
    await updateProject(id, {
      title: parsed.title,
      status: parsed.status,
      budgetUsd: parsed.budgetUsd !== undefined ? String(parsed.budgetUsd) : undefined,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return serverError(e);
  }
}
