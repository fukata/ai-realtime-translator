# AI Realtime Translator (WIP)

Minimal monorepo scaffold for a realtime translation app.

## Structure

- `frontend/`: Vite + React TypeScript client
- `server/`: Express-based token issuer (local dev / optional)
- `worker/`: Cloudflare Workers for token issuance (production)
- `tests/`: Placeholder for integration tests
- `scripts/`: Local tooling

## Getting Started

1. Install deps (Node 20+):
   - `pnpm install` (or `npm ci`)
2. Configure env:
   - Copy `.env.example` to `.env` and fill values
3. Dev servers:
   - Frontend (Vite): `pnpm --filter frontend dev`
   - Server (Express, 任意): `pnpm --filter server dev`
   - Worker (Wrangler): `pnpm --filter worker dev`

## Build & Test

- Build all: `pnpm -r build`
- Test all: `pnpm -r test`
- Lint/format: `pnpm -r lint` and `pnpm -r format`

## Notes

- Never expose `OPENAI_API_KEY` to the browser. Issue short‑lived tokens via `worker` (Cloudflare Workers) or `server` in dev.
- Enforce CORS and consider rate limiting the token endpoint.

## Cloudflare Workers

- Dev: `pnpm --filter worker dev` (defaults to `http://localhost:8787`).
- Config: `worker/wrangler.toml` (`ALLOWED_ORIGINS`, `ALLOWED_EMAILS`, `DEV_BYPASS_ACCESS`).
- Secrets: `wrangler secret put OPENAI_API_KEY`（本番では必ず Secret で設定）。
- Access: Cloudflare Access を有効化し、許可メールを限定してください。
- Token endpoint: `POST /api/token` with JSON `{ model?: string, voice?: string }`.
- Default model: `gpt-4o-realtime-preview-2024-12-17`（変更可）。
