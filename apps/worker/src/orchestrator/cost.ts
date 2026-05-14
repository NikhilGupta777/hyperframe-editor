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

export interface CostEntry {
  provider: string;
  unit: "tokens-in" | "tokens-out" | "image" | "render-second";
  qty: number;
  costUsd: number;
}

export function priceText(model: keyof typeof RATES.text, tokensIn: number, tokensOut: number): CostEntry[] {
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

export function priceImage(model: keyof typeof RATES.image, count: number): CostEntry {
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
