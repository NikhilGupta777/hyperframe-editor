/**
 * Drizzle schema. Mirrors PLAN.md §3.
 *
 * - All foreign keys cascade on delete so removing a project nukes its sources/jobs/messages cleanly.
 * - JSONB columns hold structured data: transcripts, gate reports, tool-call traces, cost ledger units.
 * - We use `text` for IDs that come from outside (workerId, provider names) and `uuid` for everything we own.
 */

import {
  pgTable,
  uuid,
  text,
  integer,
  numeric,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  monthlyBudgetUsd: numeric("monthly_budget_usd", { precision: 10, scale: 4 })
    .notNull()
    .default("10"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    preset: text("preset").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    fps: integer("fps").notNull().default(30),
    durationSec: numeric("duration_sec", { precision: 12, scale: 3 }).notNull().default("0"),
    storageUri: text("storage_uri").notNull(),
    budgetUsd: numeric("budget_usd", { precision: 10, scale: 4 }).notNull().default("1"),
    status: text("status").notNull().default("draft"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byUser: index("idx_projects_user").on(t.userId),
  }),
);

export const sources = pgTable(
  "sources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    storageUri: text("storage_uri").notNull(),
    durationSec: numeric("duration_sec", { precision: 12, scale: 3 }),
    width: integer("width"),
    height: integer("height"),
    transcript: jsonb("transcript"),
    analysis: jsonb("analysis"),
    sha256: text("sha256"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byProject: index("idx_sources_project").on(t.projectId),
  }),
);

export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    status: text("status").notNull(),
    workerId: text("worker_id"),
    input: jsonb("input"),
    output: jsonb("output"),
    error: text("error"),
    costUsd: numeric("cost_usd", { precision: 10, scale: 4 }).notNull().default("0"),
    /** Result of every quality gate, keyed by GateId. See packages/core/src/gates. */
    gates: jsonb("gates"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byProject: index("idx_jobs_project").on(t.projectId),
    byStatus: index("idx_jobs_status").on(t.status),
  }),
);

export const agentMessages = pgTable(
  "agent_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    content: jsonb("content").notNull(),
    tokensIn: integer("tokens_in"),
    tokensOut: integer("tokens_out"),
    costUsd: numeric("cost_usd", { precision: 10, scale: 4 }).notNull().default("0"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byProject: index("idx_agent_messages_project").on(t.projectId),
  }),
);

export const costEvents = pgTable(
  "cost_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    projectId: uuid("project_id"),
    jobId: uuid("job_id"),
    provider: text("provider").notNull(),
    unit: text("unit").notNull(),
    qty: numeric("qty", { precision: 14, scale: 4 }).notNull(),
    costUsd: numeric("cost_usd", { precision: 10, scale: 4 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byUser: index("idx_cost_events_user").on(t.userId),
    byProject: index("idx_cost_events_project").on(t.projectId),
  }),
);

/**
 * Stock-asset cache. Hash-keyed; once we've fetched an asset we never refetch it.
 * Phase 4 promotes this to its own bucket prefix in OCI.
 */
export const cachedAssets = pgTable("cached_assets", {
  sha256: text("sha256").primaryKey(),
  storageUri: text("storage_uri").notNull(),
  contentType: text("content_type").notNull(),
  byteSize: integer("byte_size").notNull(),
  sourceUrl: text("source_url"),
  attribution: jsonb("attribution"),
  firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;
export type Source = typeof sources.$inferSelect;
export type NewSource = typeof sources.$inferInsert;
export type Job = typeof jobs.$inferSelect;
export type NewJob = typeof jobs.$inferInsert;
export type AgentMessage = typeof agentMessages.$inferSelect;
export type NewAgentMessage = typeof agentMessages.$inferInsert;
export type CostEvent = typeof costEvents.$inferSelect;
export type NewCostEvent = typeof costEvents.$inferInsert;
export type CachedAsset = typeof cachedAssets.$inferSelect;
