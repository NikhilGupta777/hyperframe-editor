# Oracle Cloud Free Tier — deployment

Provision an Ampere A1 instance (4 OCPU / 24 GB RAM ARM64), open SSH (22) and
HTTPS (443), install Docker, then:

```bash
git clone https://github.com/NikhilGupta777/hyperframe-editor.git /opt/hf
cd /opt/hf

# 1. Drop your Vertex SA JSON at infra/oracle/secrets/sa.json
mkdir -p infra/oracle/secrets
$EDITOR infra/oracle/secrets/sa.json

# 2. Set provider keys + storage in an .env file next to the compose
cat > infra/oracle/.env <<EOF
GOOGLE_CLOUD_PROJECT=your-project-id
PIXABAY_API_KEY=...
UNSPLASH_ACCESS_KEY=...
STORAGE_ENDPOINT=https://<namespace>.compat.objectstorage.us-ashburn-1.oraclecloud.com
STORAGE_REGION=us-ashburn-1
STORAGE_ACCESS_KEY_ID=...
STORAGE_SECRET_ACCESS_KEY=...
STORAGE_BUCKET=hf-projects
EOF

# 3. Boot
docker compose --env-file infra/oracle/.env -f infra/oracle/docker-compose.yml up -d

# 4. Apply DB migrations once
docker compose -f infra/oracle/docker-compose.yml exec worker pnpm --filter @hyperframe-editor/db migrate
```

The worker image is built locally on first `up`; subsequent boots pull from
GHCR (the GitHub Actions workflow at `.github/workflows/build-worker.yml`
builds and pushes ARM64 images on every push to `main`).

## Health checks

```bash
docker compose -f infra/oracle/docker-compose.yml ps
docker compose -f infra/oracle/docker-compose.yml logs -f worker
docker compose -f infra/oracle/docker-compose.yml exec redis redis-cli xlen jobs:queue
```

## Free-tier guardrails

- Instance: 4 OCPU + 24 GB. **Do not exceed.** Oracle silently caps Always Free
  to 4 OCPU / 24 GB total per tenancy.
- Storage: 200 GB block + 10 GB object always-free. Renders go to the
  configured S3-compatible bucket (OCI Object Storage), not the worker disk.
- Egress: 10 TB/mo. At 200 MB per 1080p reel that's ~50,000 downloads.
