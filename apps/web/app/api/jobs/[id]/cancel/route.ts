import { NextResponse } from "next/server";
import { serverError } from "@/lib/api";

export const runtime = "nodejs";

/**
 * POST /api/jobs/:id/cancel — sets job.status='cancelled' and publishes a
 * cancel event the worker can react to (Phase 2: actually wire mid-job cancel).
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    if (process.env.DATABASE_URL) {
      const { markJobStatus } = await import("@hyperframe-editor/db");
      await markJobStatus(id, "cancelled", { finishedAt: new Date() });
    }
    if (process.env.REDIS_URL) {
      const { publishEvent } = await import("@hyperframe-editor/queue");
      await publishEvent(id, { type: "error", message: "cancelled" });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return serverError(e);
  }
}
