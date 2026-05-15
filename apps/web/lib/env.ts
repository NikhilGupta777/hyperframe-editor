/**
 * Runtime env validation for the web app. Imported at the top of layout.tsx
 * (server component) so a misconfigured Vercel deploy fails immediately on
 * the first request rather than 500ing deep inside a route handler.
 *
 * We split into REQUIRED (hard crash) and OPTIONAL (warn + degrade gracefully).
 * The worker has its own env validation in apps/worker/src/index.ts.
 */

interface EnvSpec {
  key: string;
  required: boolean;
  description: string;
}

const ENV_SPECS: EnvSpec[] = [
  // Required for core functionality
  {
    key: "DATABASE_URL",
    required: true,
    description: "Postgres connection string (Neon, Supabase, or self-hosted)",
  },
  // Optional — app degrades gracefully without these
  {
    key: "REDIS_URL",
    required: false,
    description: "Redis connection for job queue + SSE pub/sub. Without it, render/agent routes return 503.",
  },
  {
    key: "STORAGE_BUCKET",
    required: false,
    description: "S3 bucket name for compositions + renders. Without it, compositions are ephemeral (in-memory).",
  },
  {
    key: "STORAGE_PUBLIC_BASE_URL",
    required: false,
    description: "Public CDN/CloudFront base URL for assets. Optional; falls back to signed URLs.",
  },
  {
    key: "PIXABAY_API_KEY",
    required: false,
    description: "Pixabay stock search key. Without it, /api/stock/pixabay returns empty.",
  },
  {
    key: "UNSPLASH_ACCESS_KEY",
    required: false,
    description: "Unsplash API access key. Without it, /api/stock/unsplash returns empty.",
  },
];

export function validateEnv(): { valid: boolean; missing: string[]; warnings: string[] } {
  const missing: string[] = [];
  const warnings: string[] = [];

  for (const spec of ENV_SPECS) {
    const value = process.env[spec.key];
    if (!value || value.trim() === "") {
      if (spec.required) {
        missing.push(`${spec.key} — ${spec.description}`);
      } else {
        warnings.push(`${spec.key} not set — ${spec.description}`);
      }
    }
  }

  if (missing.length > 0) {
    console.error(
      `\n❌ [hyperframe-editor] Missing required environment variables:\n${missing.map((m) => `   • ${m}`).join("\n")}\n`,
    );
  }
  if (warnings.length > 0) {
    console.warn(
      `⚠️  [hyperframe-editor] Optional env vars not set (degraded mode):\n${warnings.map((w) => `   • ${w}`).join("\n")}`,
    );
  }

  return { valid: missing.length === 0, missing, warnings };
}
