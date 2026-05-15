# syntax=docker/dockerfile:1.7
#
# Worker image — runs on the Oracle A1 ARM64 fleet.
#
# Bakes in everything the real @hyperframes/producer pipeline needs:
#   - ffmpeg + libass + libfreetype (drawtext, captioning, loudnorm)
#   - Chromium runtime libraries (puppeteer's chrome-headless-shell deps)
#   - the producer + core packages themselves (workspace install)
#   - a chrome-headless-shell binary downloaded via puppeteer's installer
#
# Build:  docker buildx build --platform linux/arm64 -t hyperframe-editor-worker -f apps/worker/Dockerfile .
# Run:    docker run --rm -e DATABASE_URL=... -e REDIS_URL=... -e STORAGE_BUCKET=... hyperframe-editor-worker

FROM --platform=$TARGETPLATFORM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH="/pnpm:$PATH"
ENV NODE_ENV=production
# RENDER_BACKEND defaults to "hyperframes" in the runner. Operators can flip
# this to "synthetic" via docker -e for offline smoke runs against the image.
ENV RENDER_BACKEND=hyperframes
# Puppeteer cache lives under /root by default; we want a stable path that
# outlives container rebuilds when bind-mounted.
ENV PUPPETEER_CACHE_DIR=/opt/puppeteer-cache

# ---- system deps ----------------------------------------------------------
# ffmpeg — concat, probe, loudnorm, capture stub.
# fonts-liberation + fonts-noto-* — drawtext + Devanagari/Hindi presets.
# Chromium runtime libs — puppeteer's chrome-headless-shell loads these.
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    fonts-liberation fonts-noto-core fonts-noto-cjk \
    libasound2 libatk-bridge2.0-0 libatk1.0-0 libatspi2.0-0 \
    libcairo2 libcups2 libdbus-1-3 libdrm2 libgbm1 libglib2.0-0 \
    libnspr4 libnss3 libpango-1.0-0 libx11-6 libxcb1 libxcomposite1 \
    libxdamage1 libxext6 libxfixes3 libxkbcommon0 libxrandr2 \
    libwayland-client0 \
    wget xdg-utils ffmpeg \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

# ---- builder stage --------------------------------------------------------
FROM base AS builder
WORKDIR /repo

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json turbo.json tsconfig.base.json ./
COPY packages ./packages
COPY apps/worker ./apps/worker

# Workspace install (dev deps included so we can build).
RUN pnpm install --frozen-lockfile

# Build the worker + its workspace deps.
RUN pnpm --filter @hyperframe-editor/worker... build

# ---- runtime stage --------------------------------------------------------
FROM base AS runtime
WORKDIR /repo

# Copy the workspace.
COPY --from=builder /repo/pnpm-workspace.yaml /repo/pnpm-lock.yaml /repo/package.json /repo/turbo.json /repo/tsconfig.base.json ./
COPY --from=builder /repo/packages ./packages
COPY --from=builder /repo/apps/worker ./apps/worker

# Production-only install with the same lockfile. Puppeteer's postinstall
# downloads chrome-headless-shell into PUPPETEER_CACHE_DIR — that's exactly
# what we want for runtime rendering, so we DON'T set PUPPETEER_SKIP_DOWNLOAD.
RUN mkdir -p $PUPPETEER_CACHE_DIR \
  && pnpm install --prod --frozen-lockfile

# Verify chromium is present and exec()-able. Loud failure here beats a
# silent "no-chromium" skip at render time.
RUN node -e "const p=require('puppeteer'); const exe=p.executablePath(); require('fs').accessSync(exe); console.log('chromium ok:', exe)"

ENV PLACEHOLDER=0
CMD ["node", "/repo/apps/worker/dist/index.js"]
