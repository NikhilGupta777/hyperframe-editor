# hyperframe-editor

AI-native HyperFrames video editor — generates full video compositions using Gemini/Vertex AI, with a split-pane editor, live preview, 8-gate quality checks, source upload, stock search, and an interactive timeline.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server
- `pnpm --filter @workspace/hyperframe-editor run dev` — run the React frontend (Vite)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only, requires TTY — use Replit shell)

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Frontend: React 19 + Vite + Tailwind v4 + Wouter (routing)
- API: Express 5
- DB: PostgreSQL + Drizzle ORM (`lib/db/src/schema/`)
- AI: `@google/genai` SDK — auto-selects Gemini proxy (local) or Vertex AI (prod)
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (ESM bundle)

## Where things live

| Path | Purpose |
|------|---------|
| `artifacts/hyperframe-editor/src/pages/home.tsx` | Project list + create |
| `artifacts/hyperframe-editor/src/pages/editor.tsx` | Split-pane editor UI |
| `artifacts/hyperframe-editor/src/components/editor/` | AgentLog, Timeline, PropsPanel, etc. |
| `artifacts/api-server/src/routes/gemini-agent.ts` | SSE agent endpoint |
| `artifacts/api-server/src/lib/agent-bus.ts` | Core agent orchestration |
| `artifacts/api-server/src/lib/ai-client.ts` | **Unified AI client** (Gemini ↔ Vertex AI) |
| `artifacts/api-server/src/lib/hyperframes-prompt.ts` | System prompt + brief builders |
| `artifacts/api-server/src/lib/composition.ts` | Ephemeral composition storage |
| `lib/db/src/schema/` | Drizzle tables (conversations, messages) |
| `lib/api-spec/openapi.yaml` | API contract source of truth |

## AI Provider Setup

### Local dev (automatic)
The Replit Gemini integration is already provisioned. No action needed — these are set automatically:
- `AI_INTEGRATIONS_GEMINI_BASE_URL`
- `AI_INTEGRATIONS_GEMINI_API_KEY`

### Production (Vertex AI)
Set these secrets on the deployment:
| Secret | Required | Description |
|--------|----------|-------------|
| `VERTEX_AI_PROJECT_ID` | Yes | GCP project ID. Setting this switches the app to Vertex AI mode. |
| `VERTEX_AI_LOCATION` | No | GCP region (default: `us-central1`) |
| `VERTEX_AI_MODEL` | No | Override model name (default: `gemini-3.1-pro-preview`) |
| `GOOGLE_APPLICATION_CREDENTIALS` | For non-GKE | Path to service account JSON file |

With `VERTEX_AI_PROJECT_ID` set, the app uses Application Default Credentials automatically (service account JSON, Workload Identity, or `gcloud auth application-default login`).

### Other secrets
| Secret | Required | Description |
|--------|----------|-------------|
| `DATABASE_URL` | Yes | Postgres connection string |
| `PIXABAY_API_KEY` | No | Stock image/video search |
| `UNSPLASH_ACCESS_KEY` | No | Stock photo search |

## Architecture decisions

- **No Redis / no worker queue**: Agent runs are handled in-process as async tasks with an SSE event bus. This removes the Redis + worker dependency entirely. Each `POST /api/gemini/agent/turn` returns a `turnId`; the client opens `GET /api/gemini/agent/:turnId/stream` for real-time events.
- **Dual-provider AI client**: `lib/ai-client.ts` checks env vars at startup and selects either the Replit Gemini proxy or Vertex AI. The rest of the code uses the same `ai.models.generateContentStream()` call regardless.
- **Ephemeral composition storage**: Without OCI Object Storage configured, compositions live in a process-scoped Map. Sufficient for dev; wire `STORAGE_BUCKET` for production persistence.
- **HyperFrames HTML as source of truth**: The agent generates raw HTML with `data-*` timing attributes and GSAP animations — the same format as the original Next.js app. The preview iframe loads this HTML directly.
- **Migrated from Next.js to Vite + React + Express**: Original Vercel/Next.js app rebuilt on Replit's pnpm monorepo stack. Wouter handles client-side routing. All 18 original API routes preserved.

## Product

- **Home page** (`/`): Create projects with 6 presets (YouTube Essay, TikTok Hook, Product Promo, etc.)
- **Editor** (`/editor/:id`): Split-pane — left sidebar has preset selector, prompt, Generate button, 8 quality gate badges (G1–G8), and four tabs (chat / assets / history / props). Right panel has the live composition preview iframe + draggable timeline.
- **Chat tab**: Real-time Gemini agent log with SSE streaming. Tweak prompt bar for follow-up edits.
- **Assets tab**: Source video/audio/image upload + stock search (Pixabay, Unsplash).
- **Props tab**: Inline clip property editor — timing, track, GSAP block props.
- **Timeline**: Draggable, resizable clips across multiple tracks with pointer capture.

## Gotchas

- `pnpm --filter @workspace/db run push` requires an interactive TTY — run in the Replit shell, not from bash tool. Or run SQL directly via the DB tool.
- `@google/genai` must NOT be in the esbuild externals list (removed from `build.mjs`) — it gets bundled inline so the dist bundle can resolve it.
- Vertex AI requires `VERTEX_AI_PROJECT_ID`. Without it, the app falls back to the Replit Gemini proxy. If neither is set, the server throws at startup.
- The `protobufjs` package (used by `@google/genai` for Vertex AI gRPC) is in the externals and available in node_modules at runtime — do not bundle it.

## User preferences

- Local dev uses Replit Gemini proxy; production uses Vertex AI on GCP.
- No Redis — agent runs are synchronous SSE in-process.
- No OCI storage by default — ephemeral in-memory composition store is the fallback.
