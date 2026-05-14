/**
 * Tool manifest — the single source of truth for what the agent can call.
 *
 * Same shape feeds:
 *   - Vertex AI function-calling declarations (`buildVertexFunctionDecls`)
 *   - The worker's internal RPC dispatcher
 *   - Future MCP server exposure
 *   - The editor UI's "available tools" panel
 *   - OpenAPI generation
 *
 * Adding a tool: append a ToolSpec here. Implementations live in
 * apps/worker/src/tools/<category>/<name>.ts and are wired through the
 * dispatcher in apps/worker/src/tools/dispatch.ts.
 */

import { z } from "zod";

export const ToolCategorySchema = z.enum([
  "source-analysis",
  "composition",
  "stock-and-gen",
  "editing",
  "validation",
  "final",
]);
export type ToolCategory = z.infer<typeof ToolCategorySchema>;

export interface ToolSpec<I = unknown, O = unknown> {
  name: string;
  category: ToolCategory;
  description: string;
  input: z.ZodType<I>;
  output: z.ZodType<O>;
  /**
   * Cost class: cheap (<$0.001), low (<$0.01), medium (<$0.10), heavy (>=$0.10).
   * Used by the orchestrator's pre-flight cost estimator.
   */
  costClass: "cheap" | "low" | "medium" | "heavy";
}

const ProbeMediaInput = z.object({ sourceId: z.string() });
const ProbeMediaOutput = z.object({
  durationSec: z.number(),
  width: z.number().int().optional(),
  height: z.number().int().optional(),
  codec: z.string().optional(),
  hasAudio: z.boolean(),
  fps: z.number().optional(),
});

const TranscribeInput = z.object({
  sourceId: z.string(),
  language: z.string().optional(),
});
const TranscribeOutput = z.object({
  segments: z.array(
    z.object({
      start: z.number(),
      end: z.number(),
      text: z.string(),
      speaker: z.string().optional(),
    }),
  ),
  language: z.string(),
});

const StockSearchInput = z.object({
  query: z.string(),
  kind: z.enum(["image", "video"]).default("image"),
  perPage: z.number().int().min(1).max(50).default(20),
  orientation: z.enum(["any", "horizontal", "vertical", "square"]).default("any"),
});
const StockSearchOutput = z.object({
  hits: z.array(
    z.object({
      id: z.string(),
      previewUrl: z.string().url(),
      downloadUrl: z.string().url(),
      width: z.number().int(),
      height: z.number().int(),
      durationSec: z.number().optional(),
      attribution: z.object({
        provider: z.string(),
        author: z.string().optional(),
        authorUrl: z.string().url().optional(),
        sourceUrl: z.string().url().optional(),
        license: z.string(),
      }),
    }),
  ),
});

const RenderInput = z.object({
  projectId: z.string().uuid(),
  /** Composition snapshot id. If omitted, the worker uses HEAD. */
  snapshotId: z.string().optional(),
  quality: z.enum(["draft", "standard", "high"]).default("high"),
  format: z.enum(["mp4", "webm", "mov"]).default("mp4"),
});
const RenderOutput = z.object({
  jobId: z.string().uuid(),
  /** Subscribe to /api/render/:jobId/stream for progress. */
  streamUrl: z.string(),
});

/**
 * The MVP catalog. Subsequent phases append more tools.
 * Implementations are stubs in apps/worker until each phase fills them in.
 */
export const TOOL_MANIFEST: ToolSpec<unknown, unknown>[] = [
  {
    name: "probe_media",
    category: "source-analysis",
    description: "Run ffprobe over a registered source and return duration, dims, codec, audio presence.",
    input: ProbeMediaInput,
    output: ProbeMediaOutput,
    costClass: "cheap",
  } as ToolSpec,
  {
    name: "transcribe",
    category: "source-analysis",
    description: "Transcribe a source's audio with Gemini 3.1 Pro audio understanding. Returns word/segment timestamps with optional speaker diarization.",
    input: TranscribeInput,
    output: TranscribeOutput,
    costClass: "medium",
  } as ToolSpec,
  {
    name: "search_pixabay",
    category: "stock-and-gen",
    description: "Search Pixabay (free, no attribution required) for stock images or videos.",
    input: StockSearchInput,
    output: StockSearchOutput,
    costClass: "cheap",
  } as ToolSpec,
  {
    name: "search_unsplash",
    category: "stock-and-gen",
    description: "Search Unsplash for stock images. Attribution is mandatory; the orchestrator records it on the project.",
    input: StockSearchInput,
    output: StockSearchOutput,
    costClass: "cheap",
  } as ToolSpec,
  {
    name: "render",
    category: "final",
    description: "Render the project's current composition to MP4. Runs all eight quality gates.",
    input: RenderInput,
    output: RenderOutput,
    costClass: "low",
  } as ToolSpec,
];

/**
 * Group the manifest by category, useful for the editor UI and for prompt construction
 * (we present tools to the LLM grouped, not flat, to encourage correct selection).
 */
export function groupByCategory(
  manifest: ToolSpec<unknown, unknown>[],
): Record<ToolCategory, ToolSpec<unknown, unknown>[]> {
  const out: Record<ToolCategory, ToolSpec<unknown, unknown>[]> = {
    "source-analysis": [],
    composition: [],
    "stock-and-gen": [],
    editing: [],
    validation: [],
    final: [],
  };
  for (const tool of manifest) out[tool.category].push(tool);
  return out;
}
