# syntax=docker/dockerfile:1.7
#
# Worker image — runs the Oracle A1 ARM64 fleet.
# Phase 0: ships the worker placeholder + smoke tests.
# Phase 1+: bakes in @hyperframes/producer, fonts, and Chromium.
#
# Build:  docker buildx build --platform linux/arm64 -t hyperframe-editor-worker -f apps/worker/Dockerfile .
# Run:    docker run --rm -e PLACEHOLDER=1 hyperframe-editor-worker

FROM --platform=$TARGETPLATFORM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH="/pnpm:$PATH"
ENV NODE_ENV=production
ENV HYPERFRAMES_PRODUCER_AVAILABLE=0

# System deps for ffmpeg + Chromium-friendly libs (kept lean for ARM).
# Chromium itself comes from puppeteer's chrome-headless-shell at runtime.
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates fonts-liberation \
    libasound2 libatk-bridge2.0-0 libatk1.0-0 libatspi2.0-0 \
    libcairo2 libcups2 libdbus-1-3 libdrm2 libgbm1 libglib2.0-0 \
    libnspr4 libnss3 libpango-1.0-0 libx11-6 libxcb1 libxcomposite1 \
    libxdamage1 libxext6 libxfixes3 libxkbcommon0 libxrandr2 \
    wget xdg-utils ffmpeg \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

# ---- builder stage --------------------------------------------------------
FROM base AS builder
WORKDIR /repo

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json turbo.json tsconfig.base.json ./
COPY packages ./packages
COPY apps/worker ./apps/worker

# Workspace install. We install dev deps for the build, then prune.
RUN pnpm install --frozen-lockfile

# Build the worker + its workspace deps.
RUN pnpm --filter @hyperframe-editor/worker... build

# Optional: warm Chromium for puppeteer (Phase 1+). Skipped in Phase 0 — no-op
# if @hyperframes/core is absent. Kept here as a comment for future flip:
# RUN cd apps/worker && npx --no-install hyperframes browser ensure || true

# ---- runtime stage --------------------------------------------------------
FROM base AS runtime
WORKDIR /repo

# Copy only what we need to run.
COPY --from=builder /repo/pnpm-workspace.yaml /repo/pnpm-lock.yaml /repo/package.json ./
COPY --from=builder /repo/packages ./packages
COPY --from=builder /repo/apps/worker ./apps/worker

# Production-only install with the same lockfile.
RUN pnpm install --prod --frozen-lockfile

ENV PLACEHOLDER=1
CMD ["node", "/repo/apps/worker/dist/index.js"]
