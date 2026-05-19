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
