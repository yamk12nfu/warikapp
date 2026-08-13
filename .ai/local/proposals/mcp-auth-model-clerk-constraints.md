---
schema_version: 1
id: mcp-auth-model-clerk-constraints
status: open
proposed_at_commit: 9caff014665ff3fd83e5328045c12160d9baa078
sources:
  - path: "app/mcp/route.ts"
  - path: "convex/http.ts"
  - path: "docs/mcp-server-plan.md"
  - path: "proxy.ts"
---

## 提案: MCP サーバーの認可モデルと Clerk 固有の2つの制約を knowledge に追記

タイトル案: 「MCP 認可モデル: 二重境界と Clerk の azp/aud 制約」(authorization-model.md への追記が適切)

リモート MCP サーバー(`/mcp`)は既存の Clerk セッション認可と別系統の二重境界を持つ:
(1) Claude ↔ Next.js は Clerk OAuth(Bearer)、(2) Next.js ↔ Convex は内部シークレット +
検証済み userId ヘッダー(`convex/http.ts` が定数時間比較・fail closed)。ここに Clerk 固有の
非自明な制約が2つある。

1. **`CLERK_AUTHORIZED_PARTIES` は OAuth トークン検証にも波及する**: `@clerk/nextjs` の
   `auth({ acceptsToken: "oauth_token" })` はこの env の azp 検証を機械トークンにも適用するが、
   OAuth アクセストークンは azp クレームを持たないため全拒否になる(本番のみ発生した障害。
   PR #41)。このため `app/mcp/route.ts` は `@clerk/backend` の `authenticateRequest` を
   authorizedParties なしで直接呼ぶ。**Bearer 系エンドポイントを新設する際は必ず同じ考慮が要る**。
2. **Clerk は RFC 8707 resource パラメータを無視し、トークンに aud を入れない**(実測確定)。
   MCP 仕様が求める audience 拘束は実装不能で、既知の制約として受容している
   (`docs/mcp-server-plan.md` §10 R7 に受容根拠と将来の解消条件を記載)。

コードを一読しても「なぜ auth() を使わないのか」「なぜ aud 検証がないのか」は経緯を知らないと
逆に「直したく」なる箇所であり、knowledge 化の価値が高い。
