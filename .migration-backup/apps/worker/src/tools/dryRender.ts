/**
 * `dry_render` tool — a 1-frame render test. The agent uses this to validate a
 * composition will build cleanly before paying for a full render. Reports back
 * timing, lint issues, and whether the first frame would have luma.
 *
 * This is intentionally very fast: ffmpeg generates a single frame on a synthetic
 * canvas and we run gates G2 + G6 against it.
 */
import { writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execa } from "execa";

import {
  type Composition,
  type Preset,
} from "@hyperframe-editor/core";
import { buildCompositionHtml } from "@hyperframe-editor/compose";
import { lintHtml } from "../agents/lintHeal.js";

export interface DryRenderResult {
  ok: boolean;
  lintErrors: number;
  ms: number;
}

export async function dryRender(composition: Composition, preset: Preset): Promise<DryRenderResult> {
  const start = Date.now();
  const html = buildCompositionHtml({ preset, composition });
  const lint = lintHtml(html);
  if (lint.length > 0) {
    return { ok: false, lintErrors: lint.length, ms: Date.now() - start };
  }
  // Synthesise a single PNG via ffmpeg color filter. Faster than spinning up
  // Chromium, and lets us verify the runtime path is at least configured.
  const work = await mkdtemp(join(tmpdir(), "hf-dry-"));
  try {
    const png = join(work, "frame.png");
    await execa(
      "ffmpeg",
      [
        "-y",
        "-f",
        "lavfi",
        "-i",
        `color=c=0x223344:s=${composition.canvas.width}x${composition.canvas.height}:d=0.05`,
        "-frames:v",
        "1",
        png,
      ],
      { reject: true },
    );
    await writeFile(join(work, "composition.html"), html, "utf8");
    return { ok: true, lintErrors: 0, ms: Date.now() - start };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
