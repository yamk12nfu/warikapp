import { metadataCorsOptionsRequestHandler, protectedResourceHandlerClerk } from "@clerk/mcp-tools/next";

// RFC 9728 Protected Resource Metadata。/mcp の withMcpAuth が401時に案内する
// resource_metadata URL(app/mcp/route.ts の RESOURCE_METADATA_PATH)と一致させる
// パスに置く。公開必須のエンドポイントであり、proxy.ts の公開パス(完全一致)に含める。
//
// scopes_supported は "profile" のみ(計画書 §6.1)。email 等の追加スコープは要求しない
// (MCP側が使うのはuserIdだけであり、この認可 = 4ツールすべてへの一括読み取り許可という
// 粒度であることをconsent画面の説明文にもあわせて明記する)。

export const GET = protectedResourceHandlerClerk({
  scopes_supported: ["profile"],
});

// ブラウザ動作のMCPクライアント向けCORS preflight対応
export const OPTIONS = metadataCorsOptionsRequestHandler();
