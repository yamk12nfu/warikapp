// Streamable HTTPのOrigin検証(MCP仕様の必須要件。計画書 §6.1)。
//
// mcp-handler@1.1.0 はOriginヘッダーを検証しない
// (node_modules/mcp-handler/dist/index.js を確認済み。"origin"という語が出るのは
// X-Forwarded-Host等からpublicな自分自身のオリジンを算出する箇所と、
// metadataエンドポイントのCORSヘッダーだけで、受信リクエストのOriginを許可/拒否する
// ロジックは存在しない)ため、/mcp ルートの手前で自前に検証する。
//
// この検証本体を app/mcp/route.ts に直書きせず、Next.js/Clerk/mcp-handlerに
// 依存しない純関数としてここに切り出してあるのは、決定的な単体テストを
// lib/mcp/*.test.ts から行えるようにするため(route.tsを直接importすると
// @clerk/nextjs 等がNextのリクエストコンテキスト外で読み込まれ、テストが
// 不安定になる)。
//
// 契約:
//   - Originヘッダーが無ければ通す(Claude Code等の非ブラウザクライアントは
//     Originを送らない)。
//   - Originヘッダーがあれば、env WARIKAPP_MCP_ALLOWED_ORIGINS(カンマ区切り)
//     に列挙された値との完全一致以外は拒否する。

export type OriginCheckResult =
  | { allowed: true }
  | { allowed: false; reason: string };

function parseAllowedOrigins(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
}

// originHeader: リクエストの Origin ヘッダーの値(未送信なら null)。
// allowedOriginsRaw: env WARIKAPP_MCP_ALLOWED_ORIGINS の生値
//   (テストから直接値を注入できるよう、process.envを直接読まず引数化してある)。
export function checkOrigin(
  originHeader: string | null,
  allowedOriginsRaw: string | undefined,
): OriginCheckResult {
  if (originHeader === null) {
    return { allowed: true };
  }
  const allowedOrigins = parseAllowedOrigins(allowedOriginsRaw);
  if (allowedOrigins.includes(originHeader)) {
    return { allowed: true };
  }
  return {
    allowed: false,
    reason: `Origin "${originHeader}" is not in WARIKAPP_MCP_ALLOWED_ORIGINS`,
  };
}
