/**
 * Migration runner. Run with `pnpm --filter @hyperframe-editor/db migrate`.
 *
 * In CI we use `drizzle-kit push` against a disposable Postgres in docker; in
 * production we use `drizzle-kit migrate` reading from `drizzle/` directory.
 */
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { closeDb, getDb } from "./index.js";

const db = getDb();
console.log("[db] running migrations…");
await migrate(db, { migrationsFolder: "./drizzle" });
console.log("[db] migrations applied");
await closeDb();
