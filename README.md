# AI Realtime Translator (WIP)

リアルタイム翻訳アプリの最小モノレポ。フロントは Vite + React、API は Cloudflare Workers（本番）/ Express（開発任意）。

## 構成

- `frontend/`: Vite + React TypeScript クライアント
- `server/`: Express ベースのトークン発行（ローカル開発用・任意）
- `worker/`: Cloudflare Workers（本番でのトークン発行）
- `tests/`: 統合テスト用のプレースホルダー
- `scripts/`: ローカルツール類

## はじめかた（ローカル）

1. 依存インストール（Node 20+）:
   - `pnpm install`（または `npm ci`）
2. 環境変数:
   - `.env.example` を `.env` にコピーし、必要な値を設定
3. 開発サーバー:
   - Workers（API）: `pnpm --filter worker dev` → `http://localhost:8787`
   - Frontend: `pnpm --filter frontend dev` → `http://localhost:5173`
   - （任意）Express: `pnpm --filter server dev`
4. フロント画面で「Request Token」を押すと `/api/token` を呼び出します（開発初期は 501→実装済みならトークン情報返却）。

## ビルド / テスト / フォーマット

- すべてビルド: `pnpm -r build`
- すべてテスト: `pnpm -r test`
- Lint/Format: `pnpm -r lint` / `pnpm -r format`

## セキュリティと設定

- ブラウザへ `OPENAI_API_KEY` を絶対に露出しないでください。トークンは必ずサーバー（Workers/Express）で短命発行。
- CORS はフロントのオリジンのみ許可。Cloudflare Access と合わせて二重に制限してください。
- レート制限/WAF を `/api/token` に適用することを推奨します。

## Cloudflare Workers（本番想定）

- 開発起動: `pnpm --filter worker dev`（既定ポート `http://localhost:8787`）
- 設定ファイル: `worker/wrangler.toml`
  - `ALLOWED_ORIGINS`: 許可するオリジン（カンマ区切り）
  - `ALLOWED_EMAILS`: 許可メール（Access のヘッダと照合）
  - `DEV_BYPASS_ACCESS`: 開発時に Access 検証をバイパス（本番では無効）
- Secrets: `wrangler secret put OPENAI_API_KEY`（必須）
- Cloudflare Access: Pages/Workers の保護を有効にし、許可メールを限定してください。

### API: POST /api/token

- リクエスト JSON: `{ model?: string, voice?: string }`
- 既定値: `model=gpt-4o-realtime-preview-2024-12-17`, `voice=verse`
- レスポンス例:
  ```json
  {
    "id": "...",
    "model": "gpt-4o-realtime-preview-2024-12-17",
    "client_secret": {
      "value": "<ephemeral-token>",
      "expires_at": 1720000000
    }
  }
  ```
  ※ API キーは返却しません。短命トークンのみを返します。

## デプロイ（概要）

1. Workers: `OPENAI_API_KEY` を Secret として登録しデプロイ。
2. Pages: `frontend/` をビルドして配信。環境変数 `VITE_SERVER_URL` に Workers の URL を設定。
3. Access: Pages/Workers 両方に許可メール限定ポリシーを適用。
4. レート制限: Cloudflare のルールを `/api/token` に適用。

## 補足

- `server/` はローカル開発での補助用です。将来的に本番は `worker/` のみで運用します。
- このリポジトリのやり取りは日本語で統一します（詳細は `AGENTS.md` を参照）。
