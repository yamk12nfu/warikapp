# warikapp: 認可モデル（テナント分離の強制）

> 根拠: `convex/lib/auth.ts`(認可ヘルパー実装)、`docs/requirements.md` §5.2(セキュリティ要件)。
> 本ファイルは派生した索引・要約であり、正本は上記ソースである。

## 設計原則

クライアントから DB への直接アクセスは不可能で、全アクセスが Convex サーバー関数
(query / mutation / action)を経由する。**全公開関数の冒頭で認証 + 世帯メンバーシップ検証を
共通ヘルパーで強制する**(要件 5.2。Supabase でいう RLS の代替に相当し、一般公開を見据えた必須要件)。
世帯(couple)がテナント境界で、世帯間のデータは完全分離。

## 認可ヘルパー（`convex/lib/auth.ts`）

| ヘルパー | 用途 | 使いどころ |
|---|---|---|
| `requireUser(ctx)` | ログイン済み確認のみ(identity を返す) | 世帯未所属でも呼べる関数(setup 画面用)。`ctx` は `auth` を持てばよく query / mutation / action すべてから呼べる |
| `requireMember(ctx)` | ログイン + 世帯所属を確認し自分の member レコードを返す | **公開 query / mutation で世帯データに触る前に必ず呼ぶ**(セキュリティの要)。呼び出し後、取得ドキュメントの `coupleId` 一致チェックも必要 |
| `assertCoupleMemberIds(ctx, coupleId, memberIds)` | 受け取った member ID 群が全て指定世帯のメンバーであることを検証 | `paidBy` や `shares[].memberId` などクライアント由来の member ID を保存する前に必ず通す(他世帯 ID 混入 = テナント境界破りの防止) |
| `getCurrentMember`(internalQuery) | action から認証 + 所属確認するための internal query | action は DB に直接触れないため `ctx.runQuery(internal.lib.auth.getCurrentMember, {})` で利用 |

## 実装上の不変条件

- member と認証アカウントの紐付けは `members.tokenIdentifier`
  (認証プロバイダ発行の安定 ID、`by_tokenIdentifier` インデックスで検索)
- `requireMember` は member が見つからなければ throw(「世帯に参加してください」)。
  認可失敗はすべて例外で表現し、戻り値 null で流さない
- **例外: 状態確認プローブ**(現時点では `couples.currentMember` のみ)は null 返却を許可する。
  条件: (1) null を認可成功と解釈せず、後続の世帯データアクセス判断に使わない
  (2) クライアントは `useConvexAuth()` で Convex 側の認証確立を待ってから実行する
  (実行が早いと認証確立前の null を「未所属」と誤解する)
  (3) サーバー由来の identity のみで本人の行を検索し、返すのは最小フィールド
  (`_id` / `coupleId` / `displayName`)に射影する
  (4) プローブを追加する場合は本書と `docs/requirements.md` §5.2 に明示列挙する
- レシート画像の URL も世帯メンバーシップを検証したサーバー関数経由でのみ取得する(要件 5.2)
- AI API キーはサーバーサイド(Convex 環境変数)のみで保持しクライアントに露出しない(要件 5.2)
