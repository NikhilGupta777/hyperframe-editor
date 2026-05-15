import type { Config } from "drizzle-kit";

export default {
  schema: "./src/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://hf:hf@localhost:5432/hf",
  },
  strict: true,
  verbose: true,
} satisfies Config;
