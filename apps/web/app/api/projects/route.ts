import { NextResponse } from "next/server";
import { z } from "zod";
import { getPreset } from "@hyperframe-editor/core";
import { DEMO_USER_ID, badRequest, readJson, serverError } from "@/lib/api";

export const runtime = "nodejs";

const Body = z.object({
  title: z.string().min(1).max(120),
  preset: z.string().default("tiktok-hook"),
});

/**
 * GET /api/projects — list (in-memory if no DB).
 * POST /api/projects — create a draft project; persists to DB if available, or
 *   returns an ephemeral object so the editor still works in offline preview.
 */
export async function GET() {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ projects: [] });
  }
  try {
    const { listProjects } = await import("@hyperframe-editor/db");
    return NextResponse.json({ projects: await listProjects(DEMO_USER_ID) });
  } catch (e) {
    return serverError(e);
  }
}

export async function POST(req: Request) {
  const parsed = await readJson(req, Body);
  if (parsed instanceof NextResponse) return parsed;

  let preset;
  try {
    preset = getPreset(parsed.preset ?? "tiktok-hook");
  } catch (e) {
    return badRequest((e as Error).message);
  }

  const stub = {
    id: crypto.randomUUID(),
    userId: DEMO_USER_ID,
    title: parsed.title,
    preset: preset.id,
    width: preset.canvas.width,
    height: preset.canvas.height,
    fps: preset.canvas.fps,
    durationSec: 0,
    storageUri: `s3://${process.env.STORAGE_BUCKET ?? "hf-projects"}/projects/${parsed.title.replace(/\s+/g, "-")}`,
    budgetUsd: 1,
    status: "draft" as const,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ project: stub });
  }
  try {
    const { createProject } = await import("@hyperframe-editor/db");
    const project = await createProject({
      userId: DEMO_USER_ID,
      title: stub.title,
      preset: stub.preset,
      width: stub.width,
      height: stub.height,
      fps: stub.fps,
      storageUri: stub.storageUri,
    });
    return NextResponse.json({ project });
  } catch (e) {
    return serverError(e);
  }
}
