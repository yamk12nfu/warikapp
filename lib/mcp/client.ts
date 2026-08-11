import type {
  BalanceResponse,
  ExpenseBreakdownResponse,
  ListExpensesInput,
  ListExpensesResponse,
  MonthlySummaryResponse,
} from "./schemas";

// Convex内部API(convex/http.ts)を叩くfetchラッパー。MCPプロトコルは知らない
// (McpServer/CallToolResult等のSDK型に一切依存しない)。
//
// 必須env(サーバー専用。NEXT_PUBLIC_は付けない):
//   WARIKAPP_CONVEX_SITE_URL     - Convex HTTP actionのベースURL
//                                  (例: https://benevolent-koala-496.convex.site)
//   WARIKAPP_MCP_INTERNAL_SECRET - Next.js<->Convex間の内部共有シークレット
//
// 設計上の注意(docs/mcp-server-plan.md §3, §6.3):
//   - 受信リクエストのヘッダーは一切転送しない。呼び出しのたびに new Headers() から
//     組み立てる(クライアント由来の X-Warikapp-Clerk-User-Id が紛れ込む余地を
//     構造的に断つ)。
//   - Clerk OAuthトークンはこの境界を越えない。内部シークレット+検証済みuserIdのみ渡す。
//   - キャッシュしない(cache: "no-store")。タイムアウトは15秒(AbortSignal.timeout)。

const REQUEST_TIMEOUT_MS = 15000;

// Convex側の共通エラー形(計画書 §4.3)に対応するコード。
// network_error / unknown_error はNext.js層(fetch失敗・タイムアウト・JSON解析不能)
// で追加したコードで、Convexのレスポンス契約には含まれない
export type McpApiErrorCode =
  | "unauthorized"
  | "forbidden"
  | "invalid_request"
  | "not_found"
  | "rate_limited"
  | "server_not_configured"
  | "network_error"
  | "unknown_error";

export class McpApiError extends Error {
  readonly status: number;
  readonly code: McpApiErrorCode;
  readonly retryAfterSeconds?: number;

  constructor(
    status: number,
    code: McpApiErrorCode,
    message: string,
    retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "McpApiError";
    this.status = status;
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

function statusToCode(status: number): McpApiErrorCode {
  switch (status) {
    case 401:
      return "unauthorized";
    case 403:
      return "forbidden";
    case 400:
      return "invalid_request";
    case 404:
      return "not_found";
    case 429:
      return "rate_limited";
    case 503:
      return "server_not_configured";
    default:
      return "unknown_error";
  }
}

function defaultMessageFor(code: McpApiErrorCode): string {
  switch (code) {
    case "unauthorized":
      return "認証に失敗しました。";
    case "forbidden":
      return "この操作は許可されていません。";
    case "invalid_request":
      return "リクエストが不正です。";
    case "not_found":
      return "指定されたデータが見つかりません。";
    case "rate_limited":
      return "リクエストが多すぎます。";
    case "server_not_configured":
      return "サーバー側の設定が完了していません。";
    case "network_error":
      return "サーバーへの接続に失敗しました。";
    case "unknown_error":
      return "不明なエラーが発生しました。";
  }
}

// エラーレスポンスのボディを読み、型付きのMcpApiErrorへ変換する。
// ボディがJSONとして読めない・想定形でない場合はHTTPステータスからのフォールバックにする
async function toApiError(response: Response): Promise<McpApiError> {
  let code = statusToCode(response.status);
  let message = defaultMessageFor(code);
  let retryAfterSeconds: number | undefined;

  try {
    const body: unknown = await response.json();
    if (body !== null && typeof body === "object" && "error" in body) {
      const err = (body as { error?: unknown }).error;
      if (err !== null && typeof err === "object") {
        const errObj = err as { code?: unknown; message?: unknown };
        if (typeof errObj.code === "string") {
          code = errObj.code as McpApiErrorCode;
        }
        if (typeof errObj.message === "string") {
          message = errObj.message;
        }
      }
    }
    // retry_after_seconds はconvex/http.tsのレスポンス契約どおりトップレベルに
    // 乗る(errorオブジェクトの内側ではない)
    if (
      typeof (body as { retry_after_seconds?: unknown } | null)?.retry_after_seconds === "number"
    ) {
      retryAfterSeconds = (body as { retry_after_seconds: number }).retry_after_seconds;
    }
  } catch {
    // JSONとして読めない場合はstatusベースのフォールバックのまま
  }

  if (retryAfterSeconds === undefined) {
    const header = response.headers.get("Retry-After");
    if (header !== null) {
      const parsed = Number(header);
      if (Number.isFinite(parsed)) {
        retryAfterSeconds = parsed;
      }
    }
  }

  return new McpApiError(response.status, code, message, retryAfterSeconds);
}

function getConfig(): { baseUrl: string; secret: string } {
  const baseUrl = process.env.WARIKAPP_CONVEX_SITE_URL;
  const secret = process.env.WARIKAPP_MCP_INTERNAL_SECRET;
  if (baseUrl === undefined || baseUrl === "" || secret === undefined || secret === "") {
    // fail closed(計画書 §4.2 と同じ方針をNext.js側にも適用する)
    throw new McpApiError(
      503,
      "server_not_configured",
      "MCPサーバーの環境変数が未設定です。",
    );
  }
  return { baseUrl, secret };
}

async function callInternalApi<T>(
  path: string,
  searchParams: Record<string, string | undefined>,
  clerkUserId: string,
): Promise<T> {
  const { baseUrl, secret } = getConfig();
  const url = new URL(path, baseUrl);
  for (const [key, value] of Object.entries(searchParams)) {
    if (value !== undefined) {
      url.searchParams.set(key, value);
    }
  }

  // 受信リクエストのヘッダーは一切転送しない。ここで新規にHeadersを組み立てる
  const headers = new Headers();
  headers.set("Authorization", `Bearer ${secret}`);
  headers.set("X-Warikapp-Clerk-User-Id", clerkUserId);
  headers.set("Accept", "application/json");

  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers,
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (cause) {
    const isTimeout =
      cause instanceof Error && (cause.name === "TimeoutError" || cause.name === "AbortError");
    throw new McpApiError(
      0,
      "network_error",
      isTimeout
        ? "Convexへのリクエストがタイムアウトしました。"
        : "Convexへの接続に失敗しました。",
    );
  }

  if (!response.ok) {
    throw await toApiError(response);
  }

  return (await response.json()) as T;
}

export async function fetchUnsettledBalance(clerkUserId: string): Promise<BalanceResponse> {
  return callInternalApi<BalanceResponse>("/mcp/balance", {}, clerkUserId);
}

export async function fetchExpenseList(
  params: ListExpensesInput,
  clerkUserId: string,
): Promise<ListExpensesResponse> {
  return callInternalApi<ListExpensesResponse>(
    "/mcp/expenses",
    {
      filter: params.filter,
      date_from: params.date_from,
      date_to: params.date_to,
      cursor: params.cursor,
      limit: params.limit !== undefined ? String(params.limit) : undefined,
    },
    clerkUserId,
  );
}

export async function fetchMonthlySummary(
  month: string,
  clerkUserId: string,
): Promise<MonthlySummaryResponse> {
  return callInternalApi<MonthlySummaryResponse>("/mcp/summary", { month }, clerkUserId);
}

export async function fetchExpenseBreakdown(
  expenseId: string,
  clerkUserId: string,
): Promise<ExpenseBreakdownResponse> {
  return callInternalApi<ExpenseBreakdownResponse>("/mcp/expense", { id: expenseId }, clerkUserId);
}
