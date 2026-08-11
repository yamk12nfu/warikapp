import { defineApp } from "convex/server";
import { v } from "convex/values";
import rateLimiter from "@convex-dev/rate-limiter/convex.config";

// Convexコンポーネント(独立したテーブルと関数を持つ再利用部品)の登録。
// rateLimiter は receipts.parse の回数制限(30回/時/世帯)に使う。
// 自前でログ行を数える実装をやめた理由は convex/rateLimits.ts のコメント参照。
//
// env: MCPサーバー(convex/http.ts・convex/mcp.ts)が読む環境変数の型付き宣言
// (レビュー指摘 中4)。すべて未設定でも起動時エラーにしない(fail closedの実行時
// 検証は各所の呼び出し元で行う)ため v.optional(v.string()) にする
const app = defineApp({
  env: {
    WARIKAPP_MCP_INTERNAL_SECRET: v.optional(v.string()),
    WARIKAPP_MCP_INTERNAL_SECRET_PREVIOUS: v.optional(v.string()),
    CLERK_JWT_ISSUER_DOMAIN: v.optional(v.string()),
  },
});
app.use(rateLimiter);
export default app;
