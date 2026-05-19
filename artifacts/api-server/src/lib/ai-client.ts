/**
 * Unified AI client — auto-selects provider at startup.
 *
 * LOCAL DEV (Replit):
 *   Uses the Replit-managed Gemini proxy.
 *   Env vars set automatically by `setupReplitAIIntegrations`:
 *     AI_INTEGRATIONS_GEMINI_BASE_URL
 *     AI_INTEGRATIONS_GEMINI_API_KEY
 *
 * PRODUCTION (Vertex AI on GCP):
 *   Set VERTEX_AI_PROJECT_ID to switch to Vertex AI.
 *   Optional: VERTEX_AI_LOCATION  (default: us-central1)
 *             VERTEX_AI_MODEL     (default: gemini-3.1-pro-preview)
 *   Credentials are picked up automatically from:
 *     - GOOGLE_APPLICATION_CREDENTIALS (path to service account JSON), OR
 *     - Application Default Credentials (gcloud auth, Workload Identity, etc.)
 *
 * Initialization is fail-soft: the server starts successfully even if no
 * AI provider is configured. Calls to getAiClient() will throw a 503-able
 * error at request time, leaving all non-AI routes operational.
 */

import { GoogleGenAI } from "@google/genai";
import { logger } from "./logger";

export type Provider = "gemini-proxy" | "vertex-ai";

interface AiClient {
  ai: GoogleGenAI;
  provider: Provider;
  model: string;
}

function tryCreateClient(): AiClient | null {
  // ── Vertex AI (production) ──────────────────────────────────────────────
  const vertexProject = process.env.VERTEX_AI_PROJECT_ID;
  if (vertexProject) {
    const location = process.env.VERTEX_AI_LOCATION ?? "us-central1";
    const model = process.env.VERTEX_AI_MODEL ?? "gemini-3.1-pro-preview";
    logger.info(
      { provider: "vertex-ai", project: vertexProject, location, model },
      "AI provider: Vertex AI",
    );
    const ai = new GoogleGenAI({ vertexai: true, project: vertexProject, location });
    return { ai, provider: "vertex-ai", model };
  }

  // ── Replit Gemini proxy (local dev) ────────────────────────────────────
  const geminiBase = process.env.AI_INTEGRATIONS_GEMINI_BASE_URL;
  const geminiKey = process.env.AI_INTEGRATIONS_GEMINI_API_KEY;
  if (geminiBase && geminiKey) {
    const model = process.env.VERTEX_AI_MODEL ?? "gemini-3.1-pro-preview";
    logger.info({ provider: "gemini-proxy", model }, "AI provider: Replit Gemini proxy");
    const ai = new GoogleGenAI({
      apiKey: geminiKey,
      httpOptions: { apiVersion: "", baseUrl: geminiBase },
    });
    return { ai, provider: "gemini-proxy", model };
  }

  return null;
}

// Attempt initialization at startup — never throw here so non-AI routes stay up.
let _client: AiClient | null = null;
try {
  _client = tryCreateClient();
  if (!_client) {
    logger.warn(
      "No AI provider configured — AI endpoints will return 503. " +
        "Set VERTEX_AI_PROJECT_ID (production) or provision the Replit Gemini integration (local dev).",
    );
  }
} catch (err) {
  logger.error({ err }, "AI provider initialization failed — AI endpoints will return 503");
}

/**
 * Returns the active AI client. Throws if no provider is configured so
 * callers can surface a clean 503 response rather than crashing the process.
 */
export function getAiClient(): AiClient {
  if (!_client) {
    throw new Error(
      "No AI provider configured. " +
        "Set VERTEX_AI_PROJECT_ID (production) or provision the Replit Gemini integration (local dev).",
    );
  }
  return _client;
}

/** Current provider name, or null if not yet configured. */
export const configuredProvider: Provider | null = _client?.provider ?? null;
