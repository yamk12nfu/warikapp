import { verifyClerkToken } from "@clerk/mcp-tools/next";
import { auth } from "@clerk/nextjs/server";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { checkOrigin } from "@/lib/mcp/origin";
import { registerGetItemBreakdownTool } from "@/lib/mcp/tools/get-item-breakdown";
import { registerGetUnsettledBalanceTool } from "@/lib/mcp/tools/get-unsettled-balance";
import { registerListExpensesTool } from "@/lib/mcp/tools/list-expenses";
import { registerMonthlySummaryTool } from "@/lib/mcp/tools/monthly-summary";

// MCPエンドポイント(Streamable HTTP)の配線。ツール本体・認証の実処理・Origin検証の
// ロジックは lib/mcp/ 側に置き、ここは組み立て(配線)のみを行う。
//
// 必須env:
//   WARIKAPP_MCP_ALLOWED_ORIGINS - Origin検証の許可リスト(カンマ区切り。計画書 §6.1)。
//                                  未設定でもOriginヘッダーが無いリクエストは通す
//                                  (Claude Code等の非ブラウザクライアント)。
//   NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY / CLERK_SECRET_KEY - 既存のClerk設定を流用する。
//   (ツール実行時、lib/mcp/client.ts が WARIKAPP_CONVEX_SITE_URL /
//    WARIKAPP_MCP_INTERNAL_SECRET を追加で必要とする)
//
// このルートは proxy.ts の公開パス("/mcp"の完全一致)に含まれる(Bearer認証を
// Proxy層でなくwithMcpAuthが担うため)。

const RESOURCE_METADATA_PATH = "/.well-known/oauth-protected-resource/mcp";

const mcpHandler = createMcpHandler((server: McpServer) => {
  registerGetUnsettledBalanceTool(server);
  registerListExpensesTool(server);
  registerMonthlySummaryTool(server);
  registerGetItemBreakdownTool(server);
});

// @clerk/mcp-tools@0.6.0 の verifyClerkToken は withMcpAuth が要求する
// (req: Request, bearerToken?: string) => AuthInfo ではなく、
// (auth: Clerkのauth({ acceptsToken: "oauth_token" })の戻り値, token) => AuthInfo
// というシグネチャを持つ(node_modules/@clerk/mcp-tools/dist/server.d.mts で確認)。
// Clerk公式ガイドの一部はverifyClerkTokenをそのままwithMcpAuthへ渡す例を示すが、
// このバージョンではそれができないため、ここでauth()呼び出しを挟んで変換する。
async function verifyToken(
  _req: Request,
  bearerToken?: string,
): Promise<AuthInfo | undefined> {
  const clerkAuth = await auth({ acceptsToken: "oauth_token" });
  return verifyClerkToken(clerkAuth, bearerToken);
}

const authedHandler = withMcpAuth(mcpHandler, verifyToken, {
  required: true,
  resourceMetadataPath: RESOURCE_METADATA_PATH,
});

// Origin検証(Streamable HTTPのMCP仕様が要求する必須項目)。
// mcp-handler@1.1.0はOriginヘッダーを検証しない(node_modulesで確認済み。
// lib/mcp/origin.tsのコメント参照)ため、withMcpAuthより手前で自前に挟む。
// 判定ロジック自体はNext.js/Clerk/mcp-handlerに依存しない純関数(checkOrigin)に
// 切り出してあり、lib/mcp/origin.test.ts で単体テストする。
async function handleRequest(req: Request): Promise<Response> {
  const originHeader = req.headers.get("origin");
  const result = checkOrigin(originHeader, process.env.WARIKAPP_MCP_ALLOWED_ORIGINS);
  if (!result.allowed) {
    return Response.json(
      {
        error: {
          code: "forbidden",
          message: "許可されていないOriginからのリクエストです。",
        },
      },
      { status: 403 },
    );
  }
  return authedHandler(req);
}

// mcp-handlerの内部実装はエンドポイントへのGET/DELETEを405
// (JSON-RPC形式のMethod Not Allowed)で処理し、POSTだけが実際のMCPリクエストとして
// 扱われる。3メソッドとも同じhandleRequestに委譲することで、認証前チェック
// (Origin検証・Bearer検証)を先に通した上でmcp-handlerにその判定をさせる。
export { handleRequest as DELETE, handleRequest as GET, handleRequest as POST };
