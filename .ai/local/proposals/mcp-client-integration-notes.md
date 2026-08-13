---
schema_version: 1
id: mcp-client-integration-notes
status: open
proposed_at_commit: 9caff014665ff3fd83e5328045c12160d9baa078
sources:
  - path: "docs/mcp-server-plan.md"
  - path: "app/mcp/route.ts"
  - path: "lib/mcp/origin.ts"
---

## 提案: MCP サーバーへ新しいクライアント(Codex 等)を接続する際の前提条件を knowledge に残す

タイトル案: 「MCP クライアント接続の前提条件(claude.ai / Claude Code 以外も含む)」

`https://warikapp.yamk12nfu.com/mcp` は標準の Streamable HTTP + OAuth(Clerk)なので、
claude.ai / Claude Code 専用ではなく、**MCP 対応クライアント全般(Codex CLI 等)から接続できる**。
ただし接続が成立する前提条件が分散していて非自明:

- クライアントが **OAuth + Dynamic Client Registration に対応**していること(Clerk 本番で
  DCR 有効化済み。事前登録なしで接続できるのはこの設定のおかげ)
- **scope に `profile` が必要**(`app/mcp/route.ts` の requiredScopes。scope なしトークンは 403)
- **Origin ヘッダーを送らない CLI 型クライアントはそのまま通る**が、ブラウザ型クライアントは
  env `WARIKAPP_MCP_ALLOWED_ORIGINS` への追加が必要(`lib/mcp/origin.ts` の完全一致方式)
- Codex CLI の場合の設定例: `~/.codex/config.toml` に
  `[mcp_servers.warikapp]` / `url = "https://warikapp.yamk12nfu.com/mcp"` を追加し、
  初回接続時に OAuth フローを完走する(登録手順の正本は `docs/mcp-server-plan.md` §9)

「新しいクライアントを繋ぎたい」となった未来の自分が、この4点を再調査せずに済むようにする。
