export interface ProjectCostSnapshot {
  spentUsd: number;
  budgetUsd: number;
  authoritative: boolean;
}

export const DEFAULT_PROJECT_BUDGET_USD = 1.0;

export function formatUsd(usd: number): string {
  if (!Number.isFinite(usd)) return "$0.0000";
  return `$${usd.toFixed(4)}`;
}

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
