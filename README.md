# warikapp

同棲カップル向けのレシート割り勘・精算アプリ。レシート写真をAIで品目に分解し、品目単位で「自分 / 相手 / 折半」を仕分けて、未精算差額の計算と精算を行う。

- 本番: https://warikapp.yamk12nfu.com

## 技術スタック

- **Next.js 16**(App Router)+ React 19 + Tailwind CSS 4
- **Convex** — バックエンド(DB・query/mutation/action・レシートAI読み取り)
- **Clerk** — 認証(Google OAuth)
- **Vercel** — ホスティング(`vercel.json` で Convex と一体デプロイ)
- **Gemini API** — レシートOCR(既定。環境変数で Claude に切替可)

## ローカル開発

```bash
npm ci
npx convex dev   # 初回はログイン・プロジェクト選択。NEXT_PUBLIC_CONVEX_URL を .env.local に書き込む
npm run dev      # 別ターミナルで。http://localhost:3000
```

### 必要な環境変数

値や取得手順の正本は [docs/deployment.md](docs/deployment.md)(本番)と [docs/implementation-plan.md](docs/implementation-plan.md)(開発環境のセットアップ)。ここでは名前と置き場所だけ挙げる。

**`.env.local`**(Next.js 側):

| 変数 | 用途 |
|---|---|
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk 開発インスタンスの公開キー |
| `CLERK_SECRET_KEY` | Clerk 開発インスタンスの秘密キー |
| `NEXT_PUBLIC_CONVEX_URL` | `npx convex dev` が自動で書き込む(手で設定しない) |

**Convex 側**(`npx convex env set` またはダッシュボード):

| 変数 | 用途 |
|---|---|
| `CLERK_JWT_ISSUER_DOMAIN` | 必須。Clerk JWT テンプレート「convex」の Issuer |
| `GEMINI_API_KEY` | レシートAI読み取りに必要 |
| `RECEIPT_AI_PROVIDER` / `RECEIPT_AI_MODEL` | 任意。プロバイダ・モデルの切替(`claude` にする場合は `ANTHROPIC_API_KEY` も) |

## 主要コマンド

| コマンド | 内容 |
|---|---|
| `npm run dev` | 開発サーバー |
| `npm run lint` | ESLint |
| `npx tsc --noEmit` | 型チェック |
| `npm test` | vitest(convex-test + edge-runtime) |
| `npm run build` | 本番ビルド |

## ドキュメント

詳細はすべて `docs/` 配下が正本。README には転記しない。

| ドキュメント | 内容 |
|---|---|
| [docs/requirements.md](docs/requirements.md) | 要件定義書(仕様の正本) |
| [docs/implementation-plan.md](docs/implementation-plan.md) | 実装計画(Phase 0〜9。進捗トラッカーは同名 .html) |
| [docs/deployment.md](docs/deployment.md) | 本番デプロイ手順書(Clerk / Convex / Vercel / DNS) |
| [docs/verification-checklist.md](docs/verification-checklist.md) | 動作確認チェックリスト |
