import { NextResponse } from "next/server";
import { contentType as mimeFor } from "mime-types";
import { extname } from "node:path";
import { notFound, serverError } from "@/lib/api";

export const runtime = "nodejs";
// Cache for an hour at the edge; the underlying object is content-addressed
// (sha256) for stock assets and unique per-render for `cuts.mp4`, so the
// asset bytes never change behind the same URL.
export const dynamic = "force-dynamic";

/**
 * GET /api/projects/:id/assets/:name
 *
 * Same-origin passthrough for project assets stored under
 * `projects/<id>/assets/<name>` in OCI. The composition iframe hits this
 * route via the `rewriteHtmlForBrowser` substitution, so an `<img src=>` in
 * the rendered composition resolves to a same-origin URL the browser can
 * fetch without CORS dance.
 *
 * `[...name]` catches nested paths (e.g. `assets/sub/dir/foo.jpg`) so the
 * route handles any folder structure the worker chooses to write.
 *
 * Resolution order:
 *   1. STORAGE_BUCKET set + STORAGE_PUBLIC_BASE_URL set
 *      → 302-redirect to the public CDN URL (cheap, browser caches).
 *   2. STORAGE_BUCKET set without a public base
 *      → stream bytes via the SDK; no public bucket needed.
 *   3. STORAGE_BUCKET unset
 *      → 404. The synthetic preview path doesn't have any real assets.
 *
 * The redirect path is preferred when available because Next route handlers
 * pay per-byte serverless billing on Vercel; CDN is free at the edge.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; name: string[] }> },
) {
  const { id, name } = await params;
  if (!process.env.STORAGE_BUCKET) return notFound("asset");

  const subPath = name.map((p) => decodeURIComponent(p)).join("/");
  if (!subPath || subPath.includes("..")) {
    return NextResponse.json({ error: "invalid asset path" }, { status: 400 });
  }
  const key = `projects/${id}/assets/${subPath}`;

  try {
    const { getStorage } = await import("@hyperframe-editor/storage");
    const storage = getStorage();

    // Path 1: redirect to public CDN if configured.
    if (process.env.STORAGE_PUBLIC_BASE_URL) {
      const url = await storage.getUrl(key, 60 * 60);
      return NextResponse.redirect(url, { status: 302 });
    }

    // Path 2: probe + stream bytes through the route. We use HEAD to
    // distinguish 404 from server error before allocating a buffer.
    const exists = await storage.headObject(key);
    if (!exists) return notFound("asset");

    const buf = await storage.getObject(key);
    return new Response(new Uint8Array(buf), {
      headers: {
        "content-type": mimeFromExt(subPath),
        "cache-control": "public, max-age=3600",
        "content-length": String(buf.byteLength),
      },
    });
  } catch (e) {
    return serverError(e);
  }
}

function mimeFromExt(name: string): string {
  const m = mimeFor(extname(name));
  return typeof m === "string" ? m : "application/octet-stream";
}
