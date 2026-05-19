/**
 * Thin repository helpers. The web app and worker share these; raw drizzle queries
 * live close to schema, but anything used in more than one place gets named.
 */
import { eq, desc, and, gte, sql } from "drizzle-orm";
import { getDb } from "./index.js";
import {
  projects,
  jobs,
  agentMessages,
  costEvents,
  sources,
  type NewProject,
  type Project,
  type NewJob,
  type Job,
  type NewAgentMessage,
  type NewCostEvent,
  type NewSource,
  type Source,
} from "./schema.js";

// ---------- projects --------------------------------------------------------
export async function createProject(p: NewProject): Promise<Project> {
  const [row] = await getDb().insert(projects).values(p).returning();
  if (!row) throw new Error("createProject failed");
  return row;
}
export async function getProject(id: string): Promise<Project | null> {
  const [row] = await getDb().select().from(projects).where(eq(projects.id, id));
  return row ?? null;
}
export async function listProjects(userId: string): Promise<Project[]> {
  return getDb()
    .select()
    .from(projects)
    .where(eq(projects.userId, userId))
    .orderBy(desc(projects.updatedAt));
}
export async function updateProject(id: string, patch: Partial<NewProject>): Promise<void> {
  await getDb()
    .update(projects)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(projects.id, id));
}

// ---------- sources ---------------------------------------------------------
export async function registerSource(s: NewSource): Promise<Source> {
  const [row] = await getDb().insert(sources).values(s).returning();
  if (!row) throw new Error("registerSource failed");
  return row;
}
export async function listSources(projectId: string): Promise<Source[]> {
  return getDb().select().from(sources).where(eq(sources.projectId, projectId));
}

// ---------- jobs ------------------------------------------------------------
export async function createJob(j: NewJob): Promise<Job> {
  const [row] = await getDb().insert(jobs).values(j).returning();
  if (!row) throw new Error("createJob failed");
  return row;
}
export async function getJob(id: string): Promise<Job | null> {
  const [row] = await getDb().select().from(jobs).where(eq(jobs.id, id));
  return row ?? null;
}
export async function listProjectJobs(projectId: string, limit = 50): Promise<Job[]> {
  return getDb()
    .select()
    .from(jobs)
    .where(eq(jobs.projectId, projectId))
    .orderBy(desc(jobs.createdAt))
    .limit(limit);
}
export async function markJobStatus(
  id: string,
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled",
  patch: Partial<NewJob> = {},
): Promise<void> {
  await getDb()
    .update(jobs)
    .set({ status, ...patch })
    .where(eq(jobs.id, id));
}

// ---------- agent messages --------------------------------------------------
export async function appendAgentMessage(m: NewAgentMessage): Promise<void> {
  await getDb().insert(agentMessages).values(m);
}
export async function listAgentMessages(projectId: string, limit = 200) {
  return getDb()
    .select()
    .from(agentMessages)
    .where(eq(agentMessages.projectId, projectId))
    .orderBy(agentMessages.createdAt)
    .limit(limit);
}

// ---------- cost ------------------------------------------------------------
export async function recordCost(e: NewCostEvent): Promise<void> {
  await getDb().insert(costEvents).values(e);
}
export async function projectSpend(projectId: string): Promise<number> {
  // Sum in SQL; pulling rows back to JS is wasteful for large ledgers.
  const [row] = await getDb()
    .select({ total: sql<string>`coalesce(sum(${costEvents.costUsd}), 0)` })
    .from(costEvents)
    .where(eq(costEvents.projectId, projectId));
  return Number(row?.total ?? 0);
}
export async function userMonthSpend(userId: string): Promise<number> {
  // 30-day rolling window. Filter + sum in SQL so a chatty user with thousands
  // of cost_events doesn't OOM the API edge.
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const [row] = await getDb()
    .select({ total: sql<string>`coalesce(sum(${costEvents.costUsd}), 0)` })
    .from(costEvents)
    .where(and(eq(costEvents.userId, userId), gte(costEvents.createdAt, cutoff)));
  return Number(row?.total ?? 0);
}
