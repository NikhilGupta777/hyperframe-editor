/**
 * Smoke test for ACQUIRE_ASSETS. With no API keys present (the offline path)
 * the function should return an empty list cleanly, not throw. With a stub
 * Pixabay key set we mock fetch and verify download + cache metadata.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acquireAssets } from "../src/agents/acquireAssets.js";

const work = await mkdtemp(join(tmpdir(), "hf-acq-"));
let failed = 0;

try {
  // 1. Offline path — no PIXABAY_API_KEY, no UNSPLASH_ACCESS_KEY, no Vertex.
  delete process.env.PIXABAY_API_KEY;
  delete process.env.UNSPLASH_ACCESS_KEY;
  delete process.env.GOOGLE_CLOUD_PROJECT;
  delete process.env.VERTEX_PROJECT;

  const beats = [
    {
      id: "b1",
      duration: 5,
      blocks: ["KenBurnsImage"],
      assetCues: [{ slot: "bg", query: "morning chai", kind: "image" as const }],
    },
  ];
  const r = await acquireAssets({ beats, workDir: work, freeOnly: true });
  if (r.length !== 0) {
    console.error("FAIL  offline path returned non-empty:", r);
    failed++;
  } else console.log("PASS  offline path returns []");

  // 2. With a stubbed Pixabay endpoint via global fetch override.
  process.env.PIXABAY_API_KEY = "stub-key";
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.startsWith("https://pixabay.com/api/")) {
      return new Response(
        JSON.stringify({
          hits: [
            {
              id: 1234,
              webformatURL: "https://example.test/preview.jpg",
              largeImageURL: "https://example.test/full.jpg",
              imageWidth: 1080,
              imageHeight: 1920,
              pageURL: "https://example.test/photo/1234",
              user: "Alex Photog",
            },
          ],
        }),
        { status: 200 },
      );
    }
    if (url.startsWith("https://example.test/full.jpg")) {
      // 1x1 jpg
      const bytes = new Uint8Array([
        0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
        0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xdb, 0x00, 0x43,
        ...new Array(64).fill(0x10),
        0xff, 0xd9,
      ]);
      return new Response(bytes, {
        status: 200,
        headers: { "content-type": "image/jpeg" },
      });
    }
    return realFetch(input);
  }) as typeof fetch;

  try {
    const r2 = await acquireAssets({ beats, workDir: work, freeOnly: true });
    if (r2.length !== 1) {
      console.error("FAIL  stubbed pixabay didn't yield asset:", r2);
      failed++;
    } else if (!r2[0]?.asset.src.startsWith("assets/")) {
      console.error("FAIL  asset src not relative:", r2[0]?.asset.src);
      failed++;
    } else if (r2[0]?.asset.attribution?.provider !== "Pixabay") {
      console.error("FAIL  attribution missing", r2[0]);
      failed++;
    } else {
      console.log(
        `PASS  stubbed pixabay -> ${r2[0]?.asset.src} (${r2[0]?.asset.attribution?.author})`,
      );
    }
  } finally {
    globalThis.fetch = realFetch;
  }
} finally {
  await rm(work, { recursive: true, force: true });
}

if (failed > 0) process.exit(1);
console.log("\nacquire smoke OK.");
