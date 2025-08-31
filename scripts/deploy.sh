#!/usr/bin/env bash
set -euo pipefail

# Simple deployment helper for Cloudflare Worker + Pages
# Usage:
#   PAGES_PROJECT=<pages-project-name> CF_ENV=production VITE_SERVER_URL=https://<worker-url> ./scripts/deploy.sh
# Defaults:
#   CF_ENV=production
#   PAGES_PROJECT=ai-realtime-translator

CF_ENV="${CF_ENV:-production}"
PAGES_PROJECT="${PAGES_PROJECT:-ai-realtime-translator}"
# Default frontend API endpoint if not specified
VITE_SERVER_URL="${VITE_SERVER_URL:-https://ai-realtime-translator.fukata.dev}"

echo "[deploy] CF_ENV=${CF_ENV} PAGES_PROJECT=${PAGES_PROJECT}"

run() { echo "+ $*"; "$@"; }

# 1) Deploy Worker
echo "[deploy] Deploying Worker..."
(
  cd "$(dirname "$0")/../worker"
  run npx --yes wrangler deploy --env "${CF_ENV}"
)

# 2) Build Frontend (optionally inject VITE_SERVER_URL)
echo "[deploy] Building Frontend..."
(
  cd "$(dirname "$0")/../frontend"
  echo "[deploy] Using VITE_SERVER_URL=${VITE_SERVER_URL}"
  VITE_SERVER_URL="${VITE_SERVER_URL}" run npm run build
)

# 3) Deploy Pages
echo "[deploy] Deploying Pages..."
(
  cd "$(dirname "$0")/.."
  run npx --yes wrangler pages deploy frontend/dist --project-name "${PAGES_PROJECT}"
)

echo "[deploy] Done."
