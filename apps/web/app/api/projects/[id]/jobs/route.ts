import { NextResponse } from "next/server";
import { serverError } from "@/lib/api";

export const runtime = "nodejs";

/**
 * GET /api/projects/:id/jobs — recent jobs for the project.
 * Returns [] when DATABASE_URL is unset so the editor's history panel just
 * shows an empty state on bare-bones previews.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!process.env.DATABASE_URL) return NextResponse.json({ jobs: [] });
  try {
    const { listProjectJobs } = await import("@hyperframe-editor/db");
    const jobs = await listProjectJobs(id, 50);
    return NextResponse.json({ jobs });
  } catch (e) {
    return serverError(e);
  }
}
