# Repository Guidelines

## コミュニケーション方針（日本語）
- このリポジトリにおける全てのやり取り（Issue、Pull Request、コミットメッセージ、コードコメント、ドキュメント、レビュー、ディスカッション）は日本語で行います。
- コミットメッセージ・PR タイトル/本文も日本語で統一してください。
- 例外が必要な場合は理由を明記し、最小限に留めてください。

## アーキテクチャ方針（概要）
- フロントエンド: Cloudflare Pages（`frontend/` をビルドして配信）。
- API（本番）: Cloudflare Workers（`worker/`）。`POST /api/token` で OpenAI Realtime の短命トークンを発行。
- API（開発/任意）: `server/`（Express）はローカル開発補助用。将来的に本番では使用しない想定。
- 認可: Cloudflare Access（Zero Trust）で Pages/Workers を保護し、許可メールのみアクセス可能にする。
- CORS: フロントのオリジンのみ許可（Access と二重で絞る）。

## Cloudflare Access/Workers 運用ルール
- Access: 対象ルート（Pages/Workers）に許可メールを限定したポリシーを設定。
- Workers 側で `Cf-Access-Authenticated-User-Email` を検証し、`ALLOWED_EMAILS` に含まれない場合は 403。
- 開発時は `DEV_BYPASS_ACCESS=true` で Access 検証をバイパス可能（本番は常に無効）。
- Secrets: `OPENAI_API_KEY` は必ず Workers Secret に保存。ブラウザへは決して露出しない。

## 環境変数
- Workers（Secret）: `OPENAI_API_KEY`
- Workers（Vars）: `ALLOWED_ORIGINS`（カンマ区切り）, `ALLOWED_EMAILS`（カンマ区切り）, `DEV_BYPASS_ACCESS`（true/false）
- Frontend: `VITE_SERVER_URL`（開発時の API 先。既定は `http://localhost:8787`）

## デプロイ方針（概要）
1. Workers: `wrangler secret put OPENAI_API_KEY` を設定しデプロイ。
2. Pages: `frontend/` をビルドしデプロイ。環境変数に `VITE_SERVER_URL` を設定（Workers の URL）。
3. Access: Pages/Workers 両方に許可メール限定のポリシーを適用。
4. Rate Limiting: Cloudflare のレート制限/WAF を `/api/token` に適用。

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
