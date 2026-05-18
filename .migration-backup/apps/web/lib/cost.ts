/**
 * Shared cost types + formatting helpers used by the editor's top-bar pill and
 * any future billing dashboard. The actual lookup of {spentUsd, budgetUsd}
 * happens in /api/projects/:id/cost; this module is the contract.
 */

export interface ProjectCostSnapshot {
  /** Total persisted cost_events for this project, in USD. */
  spentUsd: number;
  /** Per-project cap from `projects.budget_usd`, default $1.00. */
  budgetUsd: number;
  /** True when the response came from the DB; false on the offline fallback. */
  authoritative: boolean;
}

/** Default project budget when the DB is unavailable. Mirrors PLAN.md §11. */
export const DEFAULT_PROJECT_BUDGET_USD = 1.0;

/** Compact dollar formatter for the top-bar pill. Always 4 decimals. */
export function formatUsd(usd: number): string {
  if (!Number.isFinite(usd)) return "$0.0000";
  return `$${usd.toFixed(4)}`;
}

/**
 * Sum the running cost increments emitted by the worker during a job. Each
 * `cost` SSE event carries a {costUsd, ...} payload; we sum them so the UI
 * can show "spent + in-flight" without waiting for the final costSummary.
 */
export function sumCostEvents(
  events: Array<{ type: string; name?: string; output?: unknown }>,
): number {
  let total = 0;
  for (const e of events) {
    if (e.type !== "tool" || e.name !== "cost") continue;
    const out = e.output as { costUsd?: number } | undefined;
    if (out && typeof out.costUsd === "number") total += out.costUsd;
  }
  return total;
}
