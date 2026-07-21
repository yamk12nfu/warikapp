# warikapp: プロダクト概要とデータモデル

> 根拠: `docs/requirements.md`(要件定義書)、`convex/schema.ts`(Convex スキーマ)。
> 本ファイルは派生した索引・要約であり、正本は上記ソースである。

## プロダクト概要

同棲カップル向けのレシート割り勘精算アプリ。レシート画像を AI(Claude / Gemini、環境変数
`RECEIPT_AI_PROVIDER` で切り替え)が品目・金額に構造化し、品目単位で負担区分
(自分 / 相手 / 折半 / カスタム割合)を仕分けて、未精算差額の計算と任意タイミングの精算を行う。

- テナント境界は「世帯(couple)」。2 名上限で、招待コード(8 文字英数字・有効期限 72 時間)でペアリングする
- Must 機能は F-001〜F-007(認証 / 世帯・招待 / レシート読み取り / 品目仕分け / 手入力 /
  支出管理 / 精算)。F-008 以降(仕分け AI 提案・月次サマリー・PWA/iOS 化)は Should / Could
- スタック: Next.js App Router + Tailwind(Vercel) / Convex(DB・サーバー関数・File Storage) /
  Clerk(Google OAuth)

## 中核の計算仕様(精算)

- 各品目は `shares[]`(memberId, ratioPercent)を持ち、2 名合計 100% が必須(検証はアプリ層)
- 立て替え額は品目単位で `品目金額 × 相手の負担割合%` を計算し、端数は品目ごとに四捨五入
- 精算実行で未精算支出すべてに `settlementId` を付与し差額を 0 に戻す。実送金はアプリ外
- ドラフト状態(`status: "draft"`)の支出は差額計算に含まれない。ドラフトが残っていると精算できない(V-701)

## データモデル(Convex テーブル)

| テーブル | 役割 | 主なインデックス |
|---|---|---|
| `couples` | 世帯(name のみ) | — |
| `members` | 世帯メンバー。`tokenIdentifier` で認証 ID と紐付け | `by_tokenIdentifier`, `by_coupleId` |
| `invitations` | 招待コード(code, expiresAt, usedAt) | `by_code` |
| `expenses` | 支出。品目 `items[]` をドキュメントに内包 | `by_coupleId_and_purchasedAt`, `by_coupleId_and_settlementId_and_purchasedAt` |
| `settlements` | 精算(from/to member, amount, memo, settledBy) | `by_coupleId` |
| `parseLogs` | AI 読み取りのレート制限集計用(30 回/時/世帯) | `by_coupleId` |

設計上の要点:

- 品目は独立テーブルではなく `expenses.items[]` に内包する(常に支出単位で読み書きするため。
  レシート 1 枚ぶんの有界な配列で 1MB 上限に収まる)
- `expenses.settlementId` 未設定 = 未精算。「未精算のみ」表示はインデックス範囲で絞り込む
- 削除は論理削除(`deletedAt`)。`purchasedAt` は `"YYYY-MM-DD"` 文字列
- 認可は全公開関数の冒頭で認証 + 世帯メンバーシップ検証を共通ヘルパー(`requireMember`)により
  強制する方針(要件 5.2)
