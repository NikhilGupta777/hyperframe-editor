import postgres from "postgres";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "./schema.js";

export * from "./schema.js";
export * from "./repos.js";

export type Database = PostgresJsDatabase<typeof schema>;

let cached: { client: postgres.Sql; db: Database } | null = null;

/**
 * Lazy singleton DB connection. Reads `DATABASE_URL` from env.
 * Exposed as a function so test harnesses can wipe the cache and re-init.
 */
export function getDb(databaseUrl?: string): Database {
  if (cached) return cached.db;
  const url = databaseUrl ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL not set. Pass an explicit URL or set the env var (see infra/oracle/docker-compose.yml).",
    );
  }
  const client = postgres(url, {
    max: Number(process.env.DATABASE_POOL_SIZE ?? "10"),
    idle_timeout: 30,
    connect_timeout: 10,
  });
  const db = drizzle(client, { schema });
  cached = { client, db };
  return db;
}

export async function closeDb(): Promise<void> {
  if (cached) {
    await cached.client.end({ timeout: 5 });
    cached = null;
  }
}
