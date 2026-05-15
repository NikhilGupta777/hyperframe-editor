/**
 * Migration runner. Used in two modes:
 *
 *   - As a CLI: `pnpm --filter @hyperframe-editor/db migrate`. Hits the
 *     DATABASE_URL in env, runs all migrations in `./drizzle`, exits 0/1.
 *   - As a library: `import { ensureMigrated } from "@hyperframe-editor/db"`.
 *     The worker calls this on boot so a fresh deploy doesn't 404 every
 *     query until somebody SSHs in to run psql.
 *
 * Strategy:
 *   We prefer Drizzle's official migrator when its journal/SQL pair is
 *   well-formed (split by `--> statement-breakpoint`). Our hand-authored
 *   `0000_init.sql` predates that convention and is one big idempotent
 *   blob — Drizzle's migrator chokes on it. The fallback path detects
 *   "no statement-breakpoint" SQL and runs each statement directly,
 *   guarded by a `__hf_migrations` table that tracks applied tags.
 *
 * Idempotency: every `CREATE TABLE` and `CREATE INDEX` in the SQL uses
 * `IF NOT EXISTS`, so re-running the fallback path against an already
 * migrated DB is safe even if `__hf_migrations` is missing.
 */
import { promises as fs } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { migrate as drizzleMigrate } from "drizzle-orm/postgres-js/migrator";
import { sql } from "drizzle-orm";
import postgres from "postgres";
import { closeDb, getDb } from "./index.js";

interface JournalEntry {
  idx: number;
  tag: string;
  when: number;
}
interface Journal {
  version: string;
  dialect: string;
  entries: JournalEntry[];
}

const HERE = dirname(fileURLToPath(import.meta.url));
// Resolve relative to the db package root, regardless of where the importing
// process is running from. `src/migrate.ts` → `..` lands at `packages/db/`.
const MIGRATIONS_DIR = join(HERE, "..", "drizzle");

async function readJournal(): Promise<Journal | null> {
  try {
    const raw = await fs.readFile(join(MIGRATIONS_DIR, "meta", "_journal.json"), "utf8");
    return JSON.parse(raw) as Journal;
  } catch {
    return null;
  }
}

async function readMigrationSql(tag: string): Promise<string | null> {
  try {
    return await fs.readFile(join(MIGRATIONS_DIR, `${tag}.sql`), "utf8");
  } catch {
    return null;
  }
}

/**
 * Run migrations. Idempotent: a second invocation is a no-op.
 * Returns the number of migrations newly applied this call.
 */
export async function ensureMigrated(databaseUrl?: string): Promise<{
  applied: string[];
  alreadyApplied: string[];
  strategy: "drizzle" | "fallback";
}> {
  const url = databaseUrl ?? process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set; cannot run migrations");

  // Try drizzle's migrator first. It handles its own ledger via
  // `__drizzle_migrations`. If it throws (e.g. the SQL lacks proper
  // statement-breakpoint markers), fall through to the manual path.
  const drizzleAttempt = await tryDrizzle(url);
  if (drizzleAttempt.ok) {
    return {
      applied: drizzleAttempt.applied,
      alreadyApplied: drizzleAttempt.alreadyApplied,
      strategy: "drizzle",
    };
  }
  const fallback = await runFallback(url);
  return { ...fallback, strategy: "fallback" };
}

async function tryDrizzle(url: string): Promise<
  | { ok: true; applied: string[]; alreadyApplied: string[] }
  | { ok: false; error: string }
> {
  try {
    const db = getDb(url);
    // Drizzle's migrator inspects the migrationsFolder. We give it our path.
    // Whether anything was newly applied isn't surfaced by the API, so we
    // just report empty arrays — the fallback's ledger has finer grain.
    await drizzleMigrate(db, { migrationsFolder: MIGRATIONS_DIR });
    return { ok: true, applied: [], alreadyApplied: [] };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

async function runFallback(url: string): Promise<{ applied: string[]; alreadyApplied: string[] }> {
  // We open a dedicated postgres connection (not the cached `getDb`) so the
  // migration commits cleanly even if the app pool is mid-startup.
  const client = postgres(url, { max: 1, connect_timeout: 10 });
  const applied: string[] = [];
  const alreadyApplied: string[] = [];
  try {
    await client`
      CREATE TABLE IF NOT EXISTS "__hf_migrations" (
        "tag" text PRIMARY KEY,
        "applied_at" timestamptz NOT NULL DEFAULT now()
      )
    `;
    const journal = await readJournal();
    if (!journal) {
      // No journal — nothing to do. Operator probably hasn't generated any
      // migrations yet (or we're testing against a fresh checkout).
      return { applied, alreadyApplied };
    }
    for (const entry of journal.entries.sort((a, b) => a.idx - b.idx)) {
      const exists = await client<Array<{ tag: string }>>`
        SELECT tag FROM __hf_migrations WHERE tag = ${entry.tag}
      `;
      if (exists.length > 0) {
        alreadyApplied.push(entry.tag);
        continue;
      }
      const sqlText = await readMigrationSql(entry.tag);
      if (!sqlText) {
        throw new Error(`migration file missing for tag ${entry.tag}`);
      }
      // Apply the whole SQL file in a single transaction. Postgres can run
      // multiple statements per `query()` call when they're in one string,
      // but `postgres-js` requires `unsafe()` for that. Inside a transaction
      // we get rollback on any DDL error.
      await client.begin(async (tx) => {
        await tx.unsafe(sqlText);
        await tx`INSERT INTO __hf_migrations (tag) VALUES (${entry.tag})`;
      });
      applied.push(entry.tag);
    }
  } finally {
    await client.end({ timeout: 5 });
  }
  return { applied, alreadyApplied };
}

/**
 * Quick read-only check: returns true when the canonical `projects` table
 * exists. Worker boot uses this to decide whether to apply migrations
 * before consuming jobs.
 */
export async function isMigrated(databaseUrl?: string): Promise<boolean> {
  const url = databaseUrl ?? process.env.DATABASE_URL;
  if (!url) return false;
  const client = postgres(url, { max: 1, connect_timeout: 5 });
  try {
    const rows = await client<Array<{ exists: boolean }>>`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'projects'
      ) as exists
    `;
    return rows[0]?.exists === true;
  } catch {
    return false;
  } finally {
    await client.end({ timeout: 5 });
  }
}

// CLI entry. Only runs when this file is executed directly (not imported).
const isCli = (() => {
  if (typeof process === "undefined" || !process.argv[1]) return false;
  try {
    const here = fileURLToPath(import.meta.url);
    return process.argv[1] === here || process.argv[1].endsWith("/migrate.ts") || process.argv[1].endsWith("/migrate.js");
  } catch {
    return false;
  }
})();

if (isCli) {
  console.log("[db] running migrations…");
  const r = await ensureMigrated();
  console.log(
    `[db] strategy=${r.strategy} applied=[${r.applied.join(",")}] alreadyApplied=[${r.alreadyApplied.join(",")}]`,
  );
  await closeDb();
}

// `sql` is re-exported so callers can craft ad-hoc statements without a
// second drizzle-orm import; not currently used inside this file.
export { sql };
