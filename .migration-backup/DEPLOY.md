# Deployment Guide

hyperframe-editor deploys as **two services**:

| Service | Platform | Purpose |
|---------|----------|---------|
| **Web app** (frontend + API) | Vercel | Next.js app, editor UI, API routes, SSE bridge |
| **Worker** (agent + render) | Oracle Cloud Free Tier (Docker) | Job consumer, Vertex AI agent, HyperFrames renderer |

They communicate through:
- **Postgres** (Neon) — shared database for projects, jobs, cost ledger
- **Redis** (Upstash) — job queue (Streams) + event pub/sub (worker → Vercel SSE → browser)
- **Amazon S3** — compositions, assets, rendered MP4s

---

## Prerequisites

1. **Neon Postgres** — free tier at [neon.tech](https://neon.tech). Create a database, get the connection string.
2. **Upstash Redis** — free tier at [console.upstash.com](https://console.upstash.com). Create a Redis database (pick the same region as Neon for low latency). Get the `rediss://` connection string.
3. **Oracle Cloud** — [Always Free Tier](https://www.oracle.com/cloud/free/). Provision an Ampere A1 instance (4 OCPU / 24 GB RAM) with Ubuntu 22.04 or Debian 12.
4. **Amazon S3** — create a bucket (e.g. `hyperframe-editor`) in `us-east-1`. Create an IAM user with `s3:PutObject`, `s3:GetObject`, `s3:HeadObject`, `s3:DeleteObject` permissions on that bucket. Note the access key + secret.
5. **Google Cloud / Vertex AI** — create a service account with `Vertex AI User` role. Download the JSON key.
6. **Pixabay** — free API key at [pixabay.com/api/docs/](https://pixabay.com/api/docs/).
7. **Unsplash** — free API key at [unsplash.com/developers](https://unsplash.com/developers).

---

## Step 1: Deploy the Web App to Vercel

### 1.1 Connect to Vercel

1. Push your repo to GitHub (already done).
2. Go to [vercel.com/new](https://vercel.com/new), import `NikhilGupta777/hyperframe-editor`.
3. Vercel auto-detects the `vercel.json` config. Settings should show:
   - Framework: Next.js
   - Root Directory: `.` (monorepo root)
   - Build Command: from vercel.json
   - Output Directory: `apps/web/.next`

### 1.2 Set Environment Variables

In Vercel → Project Settings → Environment Variables, add:

| Variable | Required | Example |
|----------|----------|---------|
| `DATABASE_URL` | **Yes** | `postgresql://user:pass@host/db?sslmode=require` |
| `REDIS_URL` | **Yes** (for render/agent) | `rediss://default:xxx@us1-xxx.upstash.io:6379` |
| `STORAGE_BUCKET` | Recommended | `hyperframe-editor` |
| `AWS_REGION` | If STORAGE_BUCKET set | `us-east-1` |
| `AWS_ACCESS_KEY_ID` | If STORAGE_BUCKET set | `AKIAxxxxxxxx` |
| `AWS_SECRET_ACCESS_KEY` | If STORAGE_BUCKET set | `xxxxx` |
| `STORAGE_PUBLIC_BASE_URL` | Optional (CloudFront) | `https://dxxxxxx.cloudfront.net/` |
| `PIXABAY_API_KEY` | Optional | `12345678-xxxxxxxx` |
| `UNSPLASH_ACCESS_KEY` | Optional | `your-access-key` |

### 1.3 Deploy

Click Deploy. Vercel builds the monorepo, installs deps, compiles all packages, then builds the Next.js app. First deploy takes ~3 minutes.

### 1.4 Verify

- Visit `https://your-app.vercel.app` — you should see the project list page.
- Create a project — it should persist to your Neon database.
- Click into the editor — the preview iframe should show a placeholder composition.
- The cost pill in the sidebar should show `$0.0000 / $1.0000`.

---

## Step 2: Deploy the Worker to Oracle

### 2.1 Provision the A1 instance

```bash
# SSH into your Oracle A1 instance
ssh ubuntu@<your-oracle-ip>

# Install Docker
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
# Log out and back in for group to take effect
```

### 2.2 Set up the worker

```bash
# Clone the repo
git clone https://github.com/NikhilGupta777/hyperframe-editor.git
cd hyperframe-editor

# Create the secrets directory
mkdir -p infra/oracle/secrets
# Copy your Vertex AI service account JSON here
scp local-machine:~/sa.json infra/oracle/secrets/sa.json

# Create .env for docker-compose
cat > infra/oracle/.env << 'EOF'
# Use the SAME Neon Postgres URL as Vercel
DATABASE_URL=postgresql://user:pass@host/db?sslmode=require

# Use the SAME Upstash Redis URL as Vercel
REDIS_URL=rediss://default:xxx@us1-xxx.upstash.io:6379

# Vertex AI
GOOGLE_CLOUD_PROJECT=your-project-id
GOOGLE_CLOUD_LOCATION=us-central1

# Stock
PIXABAY_API_KEY=your-key
UNSPLASH_ACCESS_KEY=your-key

# Amazon S3
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key
STORAGE_BUCKET=hyperframe-editor
STORAGE_PUBLIC_BASE_URL=

# Render backend (use 'hyperframes' for real renders, 'synthetic' for testing)
RENDER_BACKEND=hyperframes
EOF
```

### 2.3 Build and start

```bash
cd infra/oracle

# Option A: Use the pre-built image from GitHub Container Registry
docker compose pull worker
docker compose up -d worker

# Option B: Build locally on the ARM64 machine
docker compose up -d --build worker
```

**Note:** The `docker-compose.yml` includes `postgres` and `redis` services for a self-contained setup. If you're using Neon + Upstash (recommended), you only need the `worker` service:

```bash
# Start only the worker (uses external Neon + Upstash)
docker compose up -d worker
```

### 2.4 Verify the worker

```bash
# Check logs
docker compose logs -f worker

# You should see:
# [worker] starting worker-1
# [worker] production env check passed (4 vars ok)
# [worker] db.ensureMigrated strategy=fallback applied=[] alreadyApplied=[0000_init]
# [worker] health server listening on :8787/health

# Health check
curl http://localhost:8787/health
# {"status":"healthy","checks":{"loop":"ok","redis":"ok","postgres":"ok"}}
```

### 2.5 Test end-to-end

1. Go to your Vercel-deployed app
2. Create a project (e.g. "Test Render", preset: tiktok-hook)
3. Enter a prompt: "Make a 30s reel about sunrise yoga"
4. Click **Render**
5. You should see the agent stream in the chat panel:
   - `→ WRITE_BRIEF (running)`
   - `→ PLAN_BEATS (running)`
   - `→ ACQUIRE_ASSETS (running)`
   - `→ COMPOSE (running)`
   - `→ LINT (running)`
   - `→ RENDER (running)`
   - Progress bar: `render 0%` → `100%`
   - Gate badges light up green
   - `done. MP4`

---

## Architecture diagram (production)

```
Browser ──HTTPS──► Vercel (Next.js app)
                      │
                      ├── reads/writes ──► Neon Postgres
                      ├── enqueues jobs ──► Upstash Redis
                      └── subscribes SSE ◄─ Upstash Redis
                                               │
Oracle A1 Worker ◄── reads jobs ─────────────── ┘
      │
      ├── Vertex AI (Gemini 3.1 Pro, image gen)
      ├── Pixabay / Unsplash (stock search)
      ├── HyperFrames (Chromium + FFmpeg render)
      ├── writes compositions + MP4s ──► Amazon S3
      ├── updates job status ──► Neon Postgres
      └── publishes events ──► Upstash Redis ──► Vercel SSE ──► Browser
```

---

## Updating

### Web app (Vercel)
Push to `main` → Vercel auto-deploys.

### Worker (Oracle)
```bash
cd hyperframe-editor
git pull
cd infra/oracle
docker compose pull worker   # if using GHCR
docker compose up -d worker  # restarts with new image
```

Or if building locally:
```bash
docker compose up -d --build worker
```

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| "Render queue not configured" in editor | `REDIS_URL` not set on Vercel | Add it in Vercel env vars, redeploy |
| Projects don't persist | `DATABASE_URL` wrong or unreachable | Check Neon connection string, ensure SSL |
| Worker crashes on boot | Missing env vars | Check `docker compose logs worker` for the "FATAL: missing required env vars" message |
| Render stuck at 0% | Worker not running or Redis mismatch | Ensure worker and Vercel use the SAME Redis URL |
| MP4 URL returns 404 | `STORAGE_BUCKET` not configured | Set OCI storage vars on both Vercel and worker |
| Stock search returns empty | Missing API keys | Add `PIXABAY_API_KEY` / `UNSPLASH_ACCESS_KEY` |
| Gate G7 fails | Composition fetches external URLs at render time | Check the lint output — vendor the asset |
| Health check fails | DB or Redis down | `curl localhost:8787/health` shows which check failed |

---

## Cost (monthly, free tier)

| Service | Cost |
|---------|------|
| Vercel (Hobby) | $0 |
| Neon (Free) | $0 |
| Upstash Redis (Free) | $0 (10K commands/day) |
| Oracle A1 (Always Free) | $0 (4 OCPU / 24 GB) |
| Amazon S3 | $0 (free tier 5 GB, then ~$0.023/GB) |
| Vertex AI | Pay-per-use (~$0.01–0.50 per render depending on prompt complexity) |
| Pixabay | $0 |
| Unsplash | $0 |

**Total fixed cost: $0/month.** Variable cost is Vertex AI usage only.
