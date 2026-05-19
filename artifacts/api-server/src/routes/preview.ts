import { Router, type IRouter } from "express";
import { promises as fs } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const router: IRouter = Router();

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
  try {
    const require_ = createRequire(import.meta.url);
    const file = require_.resolve("@hyperframes/core/runtime");
    const source = await tryRead(file);
    if (source) return { source, resolvedFrom: file };
  } catch {
    // fallback
  }

  const cwd = process.cwd();
  const candidates = [
    join(cwd, "node_modules/@hyperframes/core/dist", RUNTIME_FILE),
    join(cwd, "artifacts/api-server/node_modules/@hyperframes/core/dist", RUNTIME_FILE),
    join(cwd, "../../node_modules/@hyperframes/core/dist", RUNTIME_FILE),
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
  return cached;
}

// GET /api/preview/runtime.js
router.get("/preview/runtime.js", async (_req, res) => {
  const result = await load();
  if (!result) {
    res.setHeader("content-type", "application/javascript; charset=utf-8");
    return res.status(404).send("// hyperframes runtime not found. Ensure @hyperframes/core is installed.\n");
  }
  res.setHeader("content-type", "application/javascript; charset=utf-8");
  res.setHeader("cache-control", "public, max-age=3600, immutable");
  return res.send(result.source);
});

export default router;
