# AI Realtime Translator (WIP)

Minimal monorepo scaffold for a realtime translation app.

## Structure

- `frontend/`: Vite + React TypeScript client
- `server/`: Express-based token issuer and optional proxy
- `tests/`: Placeholder for integration tests
- `scripts/`: Local tooling

## Getting Started

1. Install deps (Node 20+):
   - `pnpm install` (or `npm ci`)
2. Configure env:
   - Copy `.env.example` to `.env` and fill values
3. Dev servers:
   - Frontend: `pnpm --filter frontend dev`
   - Server: `pnpm --filter server dev`

## Build & Test

- Build all: `pnpm -r build`
- Test all: `pnpm -r test`
- Lint/format: `pnpm -r lint` and `pnpm -r format`

## Notes

- Never expose `OPENAI_API_KEY` to the browser. Use the `server` to issue short-lived tokens.
- Enforce CORS and consider rate limiting the token endpoint.

