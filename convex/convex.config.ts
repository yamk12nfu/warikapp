import { defineApp } from "convex/server";
import rateLimiter from "@convex-dev/rate-limiter/convex.config";

// Convexコンポーネント(独立したテーブルと関数を持つ再利用部品)の登録。
// rateLimiter は receipts.parse の回数制限(30回/時/世帯)に使う。
// 自前でログ行を数える実装をやめた理由は convex/rateLimits.ts のコメント参照。
const app = defineApp();
app.use(rateLimiter);
export default app;
