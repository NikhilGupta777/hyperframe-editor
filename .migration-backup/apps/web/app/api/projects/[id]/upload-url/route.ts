import { NextResponse } from "next/server";
import { z } from "zod";
import { readJson, serverError } from "@/lib/api";

export const runtime = "nodejs";

const Body = z.object({
  filename: z.string().min(1),
  contentType: z.string().min(3),
  /** SHA-256 of the bytes; used as cache key + integrity check. */
  sha256: z
    .string()
    .regex(/^[0-9a-f]{64}$/i)
    .optional(),
});

/**
 * POST /api/projects/:id/upload-url
 *
 * Mints a pre-signed PUT URL the browser uploads source media to directly. We
 * never proxy the bytes through Vercel — multi-hundred-MB uploads would hit
 * function timeouts.
 *
 * Without OCI configured we return a 200 with a synthetic URL so the editor's
 * upload flow still wires up in development.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = await readJson(req, Body);
  if (parsed instanceof NextResponse) return parsed;

  const safeFilename = parsed.filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  const key = `projects/${id}/sources/${Date.now()}-${safeFilename}`;

  if (!process.env.STORAGE_BUCKET) {
    return NextResponse.json({
      url: `data:dev,${key}`,
      key,
      contentType: parsed.contentType,
      method: "PUT",
      ttlSec: 0,
      hint: "STORAGE_BUCKET not configured; this is a stub URL.",
    });
  }

  try {
    const { getStorage } = await import("@hyperframe-editor/storage");
    const storage = getStorage();
    const url = await storage.signUploadUrl(key, parsed.contentType, 900);
    return NextResponse.json({
      url,
      key,
      contentType: parsed.contentType,
      method: "PUT",
      ttlSec: 900,
    });
  } catch (e) {
    return serverError(e);
  }
}
