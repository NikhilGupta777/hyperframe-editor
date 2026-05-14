import { NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import { join } from "node:path";

export const runtime = "nodejs";

/**
 * GET /api/preview/runtime.js
 *
 * Serves @hyperframes/core's runtime IIFE so the editor preview can use a
 * relative <script src> instead of CDN. Lets previews work offline / behind
 * corporate firewalls.
 */
const CANDIDATES = [
  join(process.cwd(), "node_modules/@hyperframes/core/dist/hyperframe.runtime.iife.js"),
  join(process.cwd(), "../../node_modules/@hyperframes/core/dist/hyperframe.runtime.iife.js"),
];

let cache: string | null | undefined;

async function load(): Promise<string | null> {
  if (cache !== undefined) return cache;
  for (const path of CANDIDATES) {
    try {
      cache = await fs.readFile(path, "utf8");
      return cache;
    } catch {
      // try next
    }
  }
  cache = null;
  return cache;
}

export async function GET() {
  const code = await load();
  if (!code) {
    return new NextResponse(
      "// hyperframes runtime not bundled. Add @hyperframes/core to apps/web deps.",
      { status: 404, headers: { "content-type": "application/javascript; charset=utf-8" } },
    );
  }
  return new NextResponse(code, {
    headers: {
      "content-type": "application/javascript; charset=utf-8",
      "cache-control": "public, max-age=3600, immutable",
    },
  });
}
