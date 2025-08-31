#!/usr/bin/env bash
set -euo pipefail

# Simple deployment helper for Cloudflare Worker + Pages
# Usage:
#   PAGES_PROJECT=<pages-project-name> VITE_SERVER_URL=https://<worker-url> ./scripts/deploy.sh
# Defaults:
#   PAGES_PROJECT=ai-realtime-translator

PAGES_PROJECT="${PAGES_PROJECT:-ai-realtime-translator}"
# Default frontend API endpoint if not specified
VITE_SERVER_URL="${VITE_SERVER_URL:-https://ai-realtime-translator.fukata.dev}"

echo "[deploy] PAGES_PROJECT=${PAGES_PROJECT} VITE_SERVER_URL=${VITE_SERVER_URL}"

run() { echo "+ $*"; "$@"; }

# 1) Deploy Worker
echo "[deploy] Deploying Worker..."
(
  cd "$(dirname "$0")/../worker"
  run npx --yes wrangler deploy
)

# 2) Build Frontend (optionally inject VITE_SERVER_URL)
echo "[deploy] Building Frontend..."
(
  cd "$(dirname "$0")/../frontend"
  echo "[deploy] Using VITE_SERVER_URL=${VITE_SERVER_URL}"
  VITE_SERVER_URL="${VITE_SERVER_URL}" run pnpm --filter frontend build
)

# 3) Deploy Pages
echo "[deploy] Deploying Pages..."
(
  cd "$(dirname "$0")/.."
  run npx --yes wrangler pages deploy frontend/dist --project-name "${PAGES_PROJECT}"
)

echo "[deploy] Done."
