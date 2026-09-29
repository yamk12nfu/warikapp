# warikapp のコードベースとアーキテクチャ

2026-09-06、ローカルコード `03481e9` を対象にした構成の記録。図解は [out.html](./out.html)、画像を埋め込んだ共有版は [out-shared.html](./out-shared.html)。この Markdown が説明と根拠の正本で、HTML はその視覚補助。

目次: [プロダクト](#プロダクトの中心) · [実行場所](#実行場所と通信) · [レシート](#レシートから支出へ) · [データと精算](#データモデルと精算) · [MCP](#外部-ai-からの-mcp-照会) · [コードの読み始め](#コードの読み始め) · [開発と検証](#開発配信と検証範囲)

## プロダクトの中心

同棲カップルがレシートを品目に分け、「自分・相手・折半」や負担割合を決めて、立て替えの差額を精算する。手入力にも対応する。精算機能は送金の完了を記録するもので、現金や送金アプリによる実際の支払いはアプリ外で行う。

根拠: [README](../../README.md)、[精算画面](../../app/(app)/settlement/settlement-client.tsx)。

## 実行場所と通信

| 実行場所 | 担当 | 主なコード |
|---|---|---|
| Vercel 上の Next.js | ページの配信、ログイン確認、MCP の公開窓口 | `app/`, `proxy.ts`, `lib/server-auth.ts` |
| 利用者のブラウザ | React の画面、画像圧縮、品目編集、データの購読 | `*-client.tsx`, `components/`, `lib/image.ts` |
| Convex | データベース、画像保存、世帯の権限検証、支出・精算、AI 呼び出し | `convex/` |
| Clerk | 本人確認、画面用の認証情報、MCP 用の OAuth 認証 | `ConvexClientProvider.tsx`, `convex/auth.config.ts`, `app/mcp/route.ts` |
| Gemini / Claude | レシート画像から店名・日付・品目などを抽出 | `convex/ai/` |

通常のデータ通信はブラウザから Convex へ直接行う。`ConvexProviderWithClerk` が認証を連携し、画面は `useQuery` でデータの更新を受け、`useMutation` で保存し、`useAction` で AI 読取を呼ぶ。Next.js の API ルートを毎回経由する構成ではない。

Next.js の各保護ページと `proxy.ts` がログインを確認する。Convex も `requireMember` で本人と世帯所属を確認し、対象の `coupleId` と参加者 ID を照合する。画面側のアクセス制御だけにデータ保護を任せていない。

根拠: [認証付き Provider](../../components/ConvexClientProvider.tsx)、[ページ認証](../../lib/server-auth.ts)、[Convex の所属検証](../../convex/lib/auth.ts)、[支出の保存](../../convex/expenses.ts)。

## レシートから支出へ

1. ブラウザが画像を圧縮し、Convex のアップロード URL へ送る。
2. `uploads.registerUpload` が画像の世帯帰属を記録する。
3. `receipts.parse` が画像の利用権限と回数制限を確認し、画像を AI に渡す。
4. `lib/receipt.ts` が結果を正規化する。可能な場合は税・値引きなどの合計差額を品目へ配分する。
5. 画面が `expenses.save` を呼び、`status: draft` の下書きを保存する。
6. 利用者が店名・日付・品目・支払者・負担割合を確認し、`confirmed` として保存する。

AI 読取の action 自体は支出を保存しない。画面が読取結果を受け取った後、別の mutation で下書きを永続化する。下書きは一覧に残るが、精算差額には含まれない。手入力は同じ `ExpenseEditor` を使い、AI を呼ばずに確定支出を保存する。

AI の既定プロバイダは Gemini。Convex 側の `RECEIPT_AI_PROVIDER` で Claude に変更できる。切替は設定によるもので、自動的な代替サービスへの切替ではない。

根拠: [レシート画面](../../app/(app)/expenses/new/receipt/receipt-client.tsx)、[AI 読取](../../convex/receipts.ts)、[結果の正規化](../../lib/receipt.ts)、[アップロード](../../convex/uploads.ts)、[AI の切替](../../convex/ai/index.ts)、[手入力](../../app/(app)/expenses/new/manual/manual-client.tsx)。

## データモデルと精算

未精算差額とは、まだ精算していない支出について、双方が相手のために立て替えた金額を差し引いた額。

| テーブル | 保存する情報 | 主な関連 |
|---|---|---|
| `couples` | 世帯名 | 全データの所属先 |
| `members` | 表示名、認証 ID | `coupleId` で世帯に所属 |
| `invitations` | 招待コード、有効期限、使用済み時刻 | `coupleId` |
| `expenses` | 支払者、購入日、品目、合計、状態、画像参照 | `coupleId`, `paidBy`, `settlementId` |
| `settlements` | 支払う人、受け取る人、差額、対象件数 | `coupleId`, メンバー ID |
| `uploads` | 画像の世帯帰属、アップロードした人、利用中の支出 | `coupleId`, `storageId`, `usedByExpenseId` |

品目は独立テーブルではなく `expenses.items` 配列に入る。画像ファイル本体は Convex Storage に保存し、`uploads` はその帰属を管理する。回数制限の状態は専用コンポーネントが持ち、上のアプリ用 6 テーブルには含まれない。

`lib/settlement.ts` が品目の金額と相手の負担割合から立て替え額を計算する。品目ごとに四捨五入して合算し、双方の立て替え額を差し引く。この計算を画面、支出保存、精算、MCP の集計で共用する。

精算時はサーバーで差額を再計算し、確認画面の金額・向き・件数と照合する。対象に下書きがあれば中止する。精算レコード作成と支出への `settlementId` 設定は同じ mutation 内で行う。精算済み支出は編集・削除できず、直近の精算だけ取り消して未精算へ戻せる。

未精算支出は古い購入日から最大 200 件を処理する。残りがある場合は `truncated` を返す。読み取り対象は索引で世帯・未精算・未削除に絞る。上限のある集計を全件集計と取り違えないこと。

根拠: [スキーマ](../../convex/schema.ts)、[精算の共通計算](../../lib/settlement.ts)、[精算処理](../../convex/settlements.ts)、[支出の編集制御](../../convex/expenses.ts)。

## 外部 AI からの MCP 照会

MCP は外部の AI クライアントがアプリの機能を呼ぶ接続方式。現在の公開ツールは `get_unsettled_balance`、`list_expenses`、`monthly_summary`、`get_item_breakdown`。支出データの読み取りに限定される。

外部 AI → Next.js の `/mcp` → Convex の HTTP action → 内部 query → 世帯データ、の順に進む。Next.js が Clerk の OAuth トークンと scope、Origin を検証する。Next.js から Convex へは内部共有シークレットと検証済みユーザー ID を送り、外部クライアントの OAuth トークンは転送しない。Convex がユーザーから世帯を解決して読取範囲を制限する。

MCP の照会にはデータ更新ツールがない。回数制限のカウンターだけは内部 mutation で更新する。画像・画像 URL も返さない。月次集計の対象も最大 200 件で、途中までの場合は `truncated` が返る。

`app/mcp/route.ts` は現行の認証ライブラリ経路で audience/resource の一致検証が未実装であることを既知の制約として記載している。本資料では認証を全面的な仕様準拠と評価していない。

根拠: [公開窓口](../../app/mcp/route.ts)、[サーバー間通信](../../lib/mcp/client.ts)、[内部 HTTP API](../../convex/http.ts)、[世帯別 query](../../convex/mcp.ts)、[ツール実装](../../lib/mcp/tools/)、[MCP 計画・制約](../mcp-server-plan.md)。

## コードの読み始め

| 目的 | 最初に読む場所 | 次に追う場所 |
|---|---|---|
| 画面遷移とログイン | `app/(app)/page.tsx`, `app/(app)/layout.tsx` | `lib/server-auth.ts`, `proxy.ts` |
| 世帯の作成と招待 | `app/(app)/setup/`, `app/(app)/settings/` | `convex/couples.ts` |
| ホームの支出一覧 | `app/(app)/home-client.tsx` | `convex/expenses.ts`, `convex/settlements.ts` |
| 品目入力の UI | `components/ExpenseEditor.tsx` | `lib/types.ts`, `lib/settlement.ts` |
| レシート読取 | `app/(app)/expenses/new/receipt/` | `convex/receipts.ts`, `convex/ai/`, `lib/receipt.ts` |
| 精算と取消 | `app/(app)/settlement/`, `app/(app)/settlements/` | `convex/settlements.ts` |
| AI クライアント連携 | `app/mcp/route.ts` | `lib/mcp/`, `convex/http.ts`, `convex/mcp.ts` |

`app` のページはログインを確認し、操作する画面を `*-client.tsx` に分ける。`components` は共有 UI、`lib` は共通計算・形式・補助処理、`convex` は保存と権限検証を担う。`convex/_generated` は API と型の生成物。仕様と運用手順は `docs/` を参照する。

## 開発・配信と検証範囲

`package.json` の指定は Next.js 16.2.10、React 19.2.4。Convex と Next.js をそれぞれ `npx convex dev` と `npm run dev` で起動する。`vercel.json` は Convex の deploy 内で Next.js を build する設定で、main 以外のブランチをスキップする。

既存の検証入口は `npm run lint`、`npx tsc --noEmit`、`npm test`、`npm run build`。Vitest、convex-test、edge-runtime を使うテストがあり、計算、権限、レシート、精算、MCP を対象としている。本作業ではアプリコードを変更せず、アプリのテストは実行していない。図解の生成検査・ブラウザ表示は [artifact-checks.json](./artifact-checks.json)、独立初見評価は [coldread-eval.json](./coldread-eval.json) に記録する。初見評価は1回の修正後に合格し、補足語として「未精算差額」1語が残ったため、上のデータモデル節で説明した。quick tier のため H-4 評価ループは実施していない。

これはコードの静的調査であり、本番デプロイ状況、環境変数の実値、外部 AI への実通信、実利用データを確認したものではない。コードと本番が一致することは保証しない。

根拠: [依存関係とコマンド](../../package.json)、[配信設定](../../vercel.json)、[テスト設定](../../vitest.config.ts)、[デプロイ手順](../deployment.md)。

## 図解の再生成

説明の変更はこの Markdown に反映し、`design.json` と `content.json`、SVG を更新して HTML を再生成する。`content.json` は図解スキルの組版入力で、ページテンプレートを直接編集しない。

```sh
node /Users/makinokaedenari/.agents/skills/run-cognitive-ease-infographic/scripts/render.js docs/architecture-overview/content.json -o docs/architecture-overview/out.html
node /Users/makinokaedenari/.agents/skills/run-cognitive-ease-infographic/scripts/inline-assets.js docs/architecture-overview/out.html
```

持ち出す場合は `out-shared.html` を使う。図は HTML に埋め込まれる。書体はテンプレートが Google Fonts を参照し、通信できない場合は端末の日本語書体に切り替わる。`system.svg` などの節図はテンプレートの色定義を使う中間資産なので、単体の共有用画像ではない。
