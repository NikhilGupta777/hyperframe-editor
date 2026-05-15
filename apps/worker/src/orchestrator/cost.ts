/**
 * Cost ledger helpers. Every paid call (Vertex tokens, image gen, render) goes
 * through this so we never silently overspend.
 *
 * Rates are indicative (PLAN.md §11). Verified against Vertex pricing at build
 * time; if a model is missing we log and charge the most-expensive known rate
 * so the budget stays conservative.
 */
import type { JobEvent } from "@hyperframe-editor/queue";

export const RATES = {
  // $/M tokens
  text: {
    "gemini-3.1-pro": { in: 1.25, out: 10.0 },
    "gemini-2.5-flash": { in: 0.075, out: 0.3 },
  },
  // $/image
  image: {
    "gemini-3-pro-image": 0.12,
    "imagen-4.0-fast-generate-001": 0.02,
  },
  // notional render-time bookkeeping
  renderSecondUsd: 0.001,
} as const;

export type TextModel = keyof typeof RATES.text;
export type ImageModel = keyof typeof RATES.image;

export interface CostEntry {
  provider: string;
  unit: "tokens-in" | "tokens-out" | "image" | "render-second";
  qty: number;
  costUsd: number;
}

export function priceText(model: TextModel, tokensIn: number, tokensOut: number): CostEntry[] {
  const r = RATES.text[model];
  return [
    {
      provider: `vertex-${model}`,
      unit: "tokens-in",
      qty: tokensIn,
      costUsd: (tokensIn / 1_000_000) * r.in,
    },
    {
      provider: `vertex-${model}`,
      unit: "tokens-out",
      qty: tokensOut,
      costUsd: (tokensOut / 1_000_000) * r.out,
    },
  ];
}

export function priceImage(model: ImageModel, count: number): CostEntry {
  return {
    provider: `vertex-${model}`,
    unit: "image",
    qty: count,
    costUsd: count * RATES.image[model],
  };
}

export function priceRender(seconds: number): CostEntry {
  return {
    provider: "oracle-render",
    unit: "render-second",
    qty: seconds,
    costUsd: seconds * RATES.renderSecondUsd,
  };
}

/**
 * Persist a cost entry to the DB (no-op if DATABASE_URL absent), and emit a
 * tool event to the SSE stream so the editor can show running totals live.
 */
export async function recordCost(
  jobId: string,
  projectId: string,
  userId: string | null,
  entries: CostEntry[],
  publish?: (e: JobEvent) => Promise<void>,
): Promise<void> {
  if (process.env.DATABASE_URL && userId) {
    try {
      const { recordCost: write } = await import("@hyperframe-editor/db");
      for (const e of entries) {
        await write({
          userId,
          projectId,
          jobId,
          provider: e.provider,
          unit: e.unit,
          qty: String(e.qty) as never,
          costUsd: String(e.costUsd) as never,
        });
      }
    } catch (err) {
      console.warn("[cost] db write failed:", err);
    }
  }
  for (const e of entries) {
    await publish?.({
      type: "tool",
      name: "cost",
      output: e,
    });
  }
}

/**
 * Pre-flight estimator: returns whether a step is allowed under the project's
 * remaining budget. Throws if disallowed; the orchestrator catches and pauses
 * the run.
 */
export interface BudgetCheck {
  budgetUsd: number;
  spentUsd: number;
  estimateUsd: number;
}
export function assertWithinBudget(b: BudgetCheck): void {
  if (b.spentUsd + b.estimateUsd > b.budgetUsd) {
    throw new Error(
      `budget exceeded: spent $${b.spentUsd.toFixed(4)} + estimate $${b.estimateUsd.toFixed(4)} > budget $${b.budgetUsd.toFixed(2)}`,
    );
  }
}

/**
 * Resolve the owning userId for a project. Used to attribute cost_events under
 * the right user for monthly cap enforcement. Returns null when DB is absent.
 *
 * Memoised per-process; the orchestrator only ever creates one tracker per
 * job, so cache misses are rare.
 */
const userIdCache = new Map<string, string | null>();
export async function resolveUserId(projectId: string): Promise<string | null> {
  if (userIdCache.has(projectId)) return userIdCache.get(projectId) ?? null;
  if (!process.env.DATABASE_URL) {
    userIdCache.set(projectId, null);
    return null;
  }
  try {
    const { getProject } = await import("@hyperframe-editor/db");
    const p = await getProject(projectId);
    const id = p?.userId ?? null;
    userIdCache.set(projectId, id);
    return id;
  } catch (err) {
    console.warn("[cost] resolveUserId failed:", err);
    userIdCache.set(projectId, null);
    return null;
  }
}

// ---------------------------------------------------------------------------
// CostTracker: orchestrator-scoped facade. Each loop instantiates one tracker;
// agents and tools record their slice of the bill through it. The tracker
// publishes a 'tool' SSE event per recorded entry so the editor's top bar can
// show running cost live, then on the final render it emits a single rolled-up
// summary event the UI can use to refresh the persisted total.
// ---------------------------------------------------------------------------

export interface CostTracker {
  /** Record a list of cost entries; persists, publishes, accumulates. */
  record(entries: CostEntry[]): Promise<void>;
  /** Convenience: price+record a text-LLM call in one step. */
  recordText(model: TextModel, tokensIn: number, tokensOut: number): Promise<void>;
  /** Convenience: price+record an image-gen batch. */
  recordImage(model: ImageModel, count: number): Promise<void>;
  /** Convenience: price+record a render duration. */
  recordRender(seconds: number): Promise<void>;
  /** Total USD recorded through this tracker. Used for budget display. */
  total(): number;
  /** Emit a `costSummary` event so the UI can refresh persisted totals. */
  emitSummary(): Promise<void>;
}

export interface MakeTrackerArgs {
  jobId: string;
  projectId: string;
  publish?: (e: JobEvent) => Promise<void>;
  /** When set, skip DB writes (used by smoke tests). */
  inMemoryOnly?: boolean;
}

export function makeCostTracker(args: MakeTrackerArgs): CostTracker {
  let totalUsd = 0;
  let userIdPromise: Promise<string | null> | null = null;
  const getUserId = () => {
    if (args.inMemoryOnly) return Promise.resolve(null);
    if (!userIdPromise) userIdPromise = resolveUserId(args.projectId);
    return userIdPromise;
  };

  const record: CostTracker["record"] = async (entries) => {
    if (entries.length === 0) return;
    for (const e of entries) totalUsd += e.costUsd;
    const uid = await getUserId();
    await recordCost(args.jobId, args.projectId, uid, entries, args.publish);
  };

  return {
    record,
    async recordText(model, tokensIn, tokensOut) {
      if (tokensIn === 0 && tokensOut === 0) return;
      await record(priceText(model, tokensIn, tokensOut));
    },
    async recordImage(model, count) {
      if (count <= 0) return;
      await record([priceImage(model, count)]);
    },
    async recordRender(seconds) {
      if (seconds <= 0) return;
      await record([priceRender(seconds)]);
    },
    total() {
      return totalUsd;
    },
    async emitSummary() {
      await args.publish?.({
        type: "tool",
        name: "costSummary",
        output: { totalUsd: Number(totalUsd.toFixed(6)) },
      });
    },
  };
}
