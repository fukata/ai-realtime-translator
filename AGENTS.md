# Repository Guidelines

## コミュニケーション方針（日本語）
- このリポジトリにおける全てのやり取り（Issue、Pull Request、コミットメッセージ、コードコメント、ドキュメント、レビュー、ディスカッション）は日本語で行います。
- 例外が必要な場合は理由を明記し、最小限に留めてください。

## Project Structure & Module Organization
- `frontend/`: Web client (Vite/Next.js). `src/`, `public/`, `components/`, `lib/`.
- `server/`: Token issuer and optional proxy for OpenAI Realtime. `src/index.ts`, `src/routes/token.ts`.
- `tests/`: Unit/integration tests mirroring source tree.
- `scripts/`: Local tooling (e.g., data, build helpers).
- `.env*`: Environment files (never commit secrets). Example keys are in README.

Note: This repo is being scaffolded. Create the above folders as implementation lands.

## Build, Test, and Development Commands
- Install deps (Node 20+): `pnpm install` (or `npm ci`).
- Run frontend dev server: `pnpm --filter frontend dev` (or `npm run dev` in `frontend/`).
- Run server in watch mode: `pnpm --filter server dev` (or `npm run dev` in `server/`).
- Build all packages: `pnpm -r build`.
- Test all packages: `pnpm -r test`.
- Lint/format: `pnpm -r lint` and `pnpm -r format`.

Adjust commands if using npm/yarn without workspaces.

## Coding Style & Naming Conventions
- Language: TypeScript first (server and client). Indent 2 spaces.
- Style: ESLint + Prettier (semi-colons on, single quotes, trailing commas when valid).
- Files: `kebab-case.ts(x)`. Components: `PascalCase`. Vars/functions: `camelCase`. Constants: `SCREAMING_SNAKE_CASE`.
- React: Prefer function components and hooks; colocate component styles next to code.

## Testing Guidelines
- Frameworks: Vitest/Jest on frontend; Jest + Supertest on server.
- Location: `tests/**` or `src/**/__tests__/**`.
- Names: `*.test.ts(x)`; integration: `*.spec.ts`.
- Coverage target: ≥ 80% lines/branches on changed code.
- Commands: `pnpm -r test` and `pnpm -r test -- --watch`.

## Commit & Pull Request Guidelines
- Conventional Commits: `feat:`, `fix:`, `chore:`, `refactor:`, `docs:`, `test:`. Use imperative mood; ≤ 72 chars subject.
- PRs: include purpose, linked issue(s), screenshots for UI changes, reproduction/verification steps, and notes on risks/rollout.
- Keep diffs focused; update README and types where APIs change.

## Security & Configuration Tips
- Never expose `OPENAI_API_KEY` to the browser. Issue short‑lived tokens from `server`.
- Store secrets in `.env` (local) and environment variables (prod). Do not commit.
- Enforce CORS on the token endpoint; add rate limits and basic auth if needed.
- Prefer WebRTC for low latency; validate codecs and handle reconnects.
