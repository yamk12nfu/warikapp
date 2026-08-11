import { authServerMetadataHandlerClerk, metadataCorsOptionsRequestHandler } from "@clerk/mcp-tools/next";

// RFC 8414 Authorization Server Metadata。RFC 9728(protected resource metadata)を
// 解釈できない旧仕様のMCPクライアント向けの互換エンドポイント。公開必須であり、
// proxy.ts の公開パス(完全一致)に含める。

export const GET = authServerMetadataHandlerClerk();

// ブラウザ動作のMCPクライアント向けCORS preflight対応
export const OPTIONS = metadataCorsOptionsRequestHandler();
