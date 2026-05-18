import { NextResponse } from "next/server";
import { notFound, serverError } from "@/lib/api";

export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!process.env.DATABASE_URL) return notFound("job");
  try {
    const { getJob } = await import("@hyperframe-editor/db");
    const job = await getJob(id);
    return job ? NextResponse.json({ job }) : notFound("job");
  } catch (e) {
    return serverError(e);
  }
}
