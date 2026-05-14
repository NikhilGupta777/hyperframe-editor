# hyperframe-editor

An AI-native video-editor agent. You drop in raw footage (or just a prompt), pick a preset, and the agent watches/listens to your video, plans a timeline, fetches B-roll, generates motion graphics, writes captions, renders, and hands you back a polished MP4. You can chat with it to revise, or open the timeline and edit manually.

**Status:** planning. Code lands after the plan is reviewed.

## Stack at a glance

| Layer | Tech |
| --- | --- |
| Frontend | Next.js 15 (App Router) on Vercel, React 19, Tailwind, `<hyperframes-player>` web component for preview |
| Agent / API | Next.js Route Handlers (Vercel) + a long-job orchestrator on Oracle |
| Composition engine | [HyperFrames](https://github.com/heygen-com/hyperframes) (Apache-2.0) — HTML compositions, deterministic Chromium + FFmpeg render |
| Reasoning | Vertex AI Gemini 3.1 Pro (text, audio, video, image, code, 1M context) |
| Image generation | Gemini 3 Pro Image (Nano Banana Pro) and Imagen 4 on Vertex AI |
| Stock media | Pixabay (free), Unsplash (free, attribution), Freepik (paid + AI gen) |
| Render fleet | Oracle Cloud Free Tier — Ampere A1 ARM, 4 OCPU / 24 GB RAM, 200 GB block storage |
| Storage | Oracle Object Storage (S3-compatible) for projects + rendered MP4s |
| Queue / DB | Postgres (Neon free tier) + lightweight in-DB job queue, or BullMQ on the Oracle box with Redis |
| Observability | Logflare or Axiom (free tier) for request logs; Postgres for job/cost ledger |

## Where to start reading

1. **[PLAN.md](./PLAN.md)** — the master plan. Architecture, agent state machine, preset library, editor UI spec, API surface, env vars, phased roadmap.
2. **[NOTES.md](./NOTES.md)** — distilled research. HyperFrames primer, the patterns we steal from the Cloudflare/Vercel templates + VibeFrame + mcp-video + video-use, Gemini 3.1 Pro capabilities, stock-API quirks, Oracle Free Tier limits.

`research/` (gitignored) has the six reference repos cloned for local inspection while iterating on the plan.
