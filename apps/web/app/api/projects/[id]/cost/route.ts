import { NextResponse } from "next/server";
import { serverError } from "@/lib/api";
import { DEFAULT_PROJECT_BUDGET_USD, type ProjectCostSnapshot } from "@/lib/cost";

export const runtime = "nodejs";

/**
 * GET /api/projects/:id/cost — return the project's running cost snapshot.
 *
 * The editor's top-bar pill polls this on mount and refreshes after every
 * `costSummary` SSE event so the persisted total catches up with the
 * in-flight running sum.
 *
 * When DATABASE_URL is unset (Vercel preview without infra) we return zeros
 * with `authoritative: false` so the client can choose to hide the pill or
 * label it as "preview".
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!process.env.DATABASE_URL) {
    const snap: ProjectCostSnapshot = {
      spentUsd: 0,
      budgetUsd: DEFAULT_PROJECT_BUDGET_USD,
      authoritative: false,
    };
    return NextResponse.json(snap);
  }
  try {
    const { projectSpend, getProject } = await import("@hyperframe-editor/db");
    const [spent, project] = await Promise.all([projectSpend(id), getProject(id)]);
    const snap: ProjectCostSnapshot = {
      spentUsd: Number(spent.toFixed(6)),
      budgetUsd: project ? Number(project.budgetUsd) : DEFAULT_PROJECT_BUDGET_USD,
      authoritative: true,
    };
    return NextResponse.json(snap);
  } catch (e) {
    return serverError(e);
  }
}
