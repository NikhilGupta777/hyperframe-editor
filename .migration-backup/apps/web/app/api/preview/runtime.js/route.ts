import { NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

export const runtime = "nodejs";

/**
 * GET /api/preview/runtime.js
 *
 * Serves the @hyperframes/core runtime IIFE so the editor preview iframe can
 * use a same-origin <script src="/api/preview/runtime.js"> instead of a CDN.
 * That keeps gate G7 happy (no off-origin fetch during render) and lets the
 * preview load behind a corporate firewall or in an offline preview deploy.
 *
 * Resolution strategy:
 *   1. `createRequire(import.meta.url).resolve("@hyperframes/core/runtime")`.
 *      The package's `exports` map exposes `./runtime` as a direct subpath
 *      to the IIFE bundle, so Node's resolver hands back the absolute file
 *      path through pnpm's symlink layout. This is the canonical way and
 *      what we expect to succeed in every supported deployment (Vercel
 *      lambda, Oracle docker, local pnpm).
 *   2. Filesystem fallbacks. Cover Next standalone builds that strip the
 *      package.json `exports` map and rely on hoisted node_modules.
 *
 * The file is small (~70-180 KB) and immutable per @hyperframes/core release,
 * so we cache the bytes in module scope and serve with a one-hour
 * `Cache-Control` header. A worker restart re-reads from disk.
 */
const RUNTIME_FILE = "hyperframe.runtime.iife.js";

let cached: { source: string; resolvedFrom: string } | null | undefined;

async function tryRead(absPath: string): Promise<string | null> {
  try {
    return await fs.readFile(absPath, "utf8");
  } catch {
    return null;
  }
}

async function resolveAndLoad(): Promise<{ source: string; resolvedFrom: string } | null> {
  // 1. Resolve via the package's `./runtime` subpath export. The
  //    @hyperframes/core package.json maps `./runtime` → the IIFE bundle.
  try {
    const require_ = createRequire(import.meta.url);
    const file = require_.resolve("@hyperframes/core/runtime");
    const source = await tryRead(file);
    if (source) return { source, resolvedFrom: file };
  } catch {
    // Older @hyperframes/core versions or vendored builds may lack the
    // `./runtime` subpath; fall through to filesystem search.
  }

  // 2. Filesystem fallbacks. Cover both `pnpm install` (per-package symlinks
  //    under apps/web/node_modules/@hyperframes/core/dist) and Next standalone
  //    builds (a copy at the standalone root).
  const cwd = process.cwd();
  const candidates = [
    join(cwd, "node_modules/@hyperframes/core/dist", RUNTIME_FILE),
    join(cwd, "apps/web/node_modules/@hyperframes/core/dist", RUNTIME_FILE),
    join(cwd, "../../node_modules/@hyperframes/core/dist", RUNTIME_FILE),
    join(cwd, "../../../node_modules/@hyperframes/core/dist", RUNTIME_FILE),
  ];
  for (const path of candidates) {
    const source = await tryRead(path);
    if (source) return { source, resolvedFrom: path };
  }
  return null;
}

async function load(): Promise<{ source: string; resolvedFrom: string } | null> {
  if (cached !== undefined) return cached;
  cached = await resolveAndLoad();
  if (cached) {
    console.log(`[preview/runtime] serving from ${cached.resolvedFrom}`);
  }
  return cached;
}

export async function GET() {
  const result = await load();
  if (!result) {
    // 404 with a JS comment so the iframe's <script> tag fails loudly in the
    // dev console rather than silently aborting timeline registration.
    return new NextResponse(
      "// hyperframes runtime not found. Ensure @hyperframes/core is installed in apps/web.\n",
      {
        status: 404,
        headers: { "content-type": "application/javascript; charset=utf-8" },
      },
    );
  }
  return new NextResponse(result.source, {
    headers: {
      "content-type": "application/javascript; charset=utf-8",
      // Immutable per release; revisit if we ever start patching the runtime.
      "cache-control": "public, max-age=3600, immutable",
    },
  });
}
