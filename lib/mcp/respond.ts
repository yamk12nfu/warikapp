import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { McpApiError, type McpApiErrorCode } from "./client";
import { buildTextContent } from "./format";

// ツール結果の組み立てヘルパー。
//   - 成功時: structuredContent + 同じJSONを含むTextContentを併記する
//     (MCP仕様の推奨。クライアントがoutputSchema未対応でも内容を読めるようにする)。
//   - 失敗時: プロトコルエラーではなく isError: true の Tool Execution Error として
//     返す(モデルが読んで再試行・言い換えできる形。計画書 §5.3)。
//     エラー文には次の一手を必ず含める。

export function toolSuccess(
  summaryText: string,
  structuredContent: Record<string, unknown>,
): CallToolResult {
  return {
    content: [{ type: "text", text: buildTextContent(summaryText, structuredContent) }],
    structuredContent,
  };
}

// エラーコードごとの「次の一手」文言(計画書 §5.3・§5.4 の例に準拠)
const NEXT_STEP_BY_CODE: Record<McpApiErrorCode, string> = {
  not_found: "list_expenses で有効な ID を確認してください。",
  forbidden: "warikapp で世帯に参加してから再接続してください。",
  unauthorized: "MCP接続の認証が切れている可能性があります。claude.ai / Claude Code 側で再接続してください。",
  invalid_request: "引数の形式を確認し、正しい値で再試行してください。",
  rate_limited: "時間をおいて再試行してください。",
  server_not_configured: "サーバー側の設定不備です。しばらくしてから再試行するか、管理者に連絡してください。",
  network_error: "時間をおいて再試行してください。",
  unknown_error: "時間をおいて再試行してください。解決しない場合は管理者に連絡してください。",
};

export function toolErrorFromApiError(error: McpApiError): CallToolResult {
  const nextStep = NEXT_STEP_BY_CODE[error.code];
  const retrySuffix =
    error.retryAfterSeconds !== undefined
      ? `(${error.retryAfterSeconds}秒後に再試行してください)`
      : "";
  return {
    isError: true,
    content: [
      {
        type: "text",
        text: `エラー: ${error.message} ${nextStep}${retrySuffix}`.trim(),
      },
    ],
  };
}

// McpApiError以外(想定外の例外)も含めて isError:true の結果に変換する。
// 各ツールハンドラの catch はこれ1つを呼べばよい
export function toolErrorFromUnknown(error: unknown): CallToolResult {
  if (error instanceof McpApiError) {
    return toolErrorFromApiError(error);
  }
  const message = error instanceof Error ? error.message : String(error);
  return {
    isError: true,
    content: [
      {
        type: "text",
        text: `エラー: 予期しないエラーが発生しました(${message})。時間をおいて再試行してください。`,
      },
    ],
  };
}

// registerToolのハンドラに渡ってくる extra(RequestHandlerExtra)から、
// withMcpAuth 経由で検証済みのClerk userIdを取り出す。
// verifyClerkToken(@clerk/mcp-tools)は AuthInfo.extra.userId にuserIdを積む実装のため、
// その形に合わせて読む。required: true を通っている前提の防御的チェック
type ToolExtraLike = { authInfo?: { extra?: Record<string, unknown> } };

export function getClerkUserId(extra: ToolExtraLike): string {
  const userId = extra.authInfo?.extra?.userId;
  if (typeof userId !== "string" || userId === "") {
    throw new Error("認証情報からuserIdを取得できませんでした");
  }
  return userId;
}
