import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  fetchExpenseBreakdown,
  fetchExpenseList,
  fetchMonthlySummary,
  fetchUnsettledBalance,
  McpApiError,
} from "./client";

function jsonResponse(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json", ...init.headers },
  });
}

describe("lib/mcp/client", () => {
  beforeEach(() => {
    vi.stubEnv("WARIKAPP_CONVEX_SITE_URL", "https://example.convex.site");
    vi.stubEnv("WARIKAPP_MCP_INTERNAL_SECRET", "s3cr3t");
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  test("env未設定ならfetchを呼ばずに503 server_not_configuredで失敗する(fail closed)", async () => {
    vi.unstubAllEnvs();
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    await expect(fetchUnsettledBalance("user_1")).rejects.toMatchObject({
      status: 503,
      code: "server_not_configured",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("Headersを毎回新規構築し、Authorization/X-Warikapp-Clerk-User-Id/Acceptだけを積む", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        currency: "JPY",
        amount: 0,
        direction: "even",
        self: { member_id: "m1", display_name: "self" },
        partner: null,
        paid_by_self: 0,
        paid_by_partner: 0,
        included_expense_count: 0,
        draft_count: 0,
        truncated: false,
      }),
    );

    await fetchUnsettledBalance("user_abc");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://example.convex.site/mcp/balance");
    expect(options.headers).toBeInstanceOf(Headers);
    const headers = options.headers as Headers;
    expect(headers.get("Authorization")).toBe("Bearer s3cr3t");
    expect(headers.get("X-Warikapp-Clerk-User-Id")).toBe("user_abc");
    expect(headers.get("Accept")).toBe("application/json");
    // 受信リクエストのヘッダーを転送する余地が無いことの確認として、
    // 想定外のヘッダーが紛れ込んでいないことも見ておく
    const keys = Array.from(headers.keys()).sort();
    expect(keys).toEqual(["accept", "authorization", "x-warikapp-clerk-user-id"]);
  });

  test("cache: no-store を毎回付与する", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        currency: "JPY",
        amount: 0,
        direction: "even",
        self: { member_id: "m1", display_name: "self" },
        partner: null,
        paid_by_self: 0,
        paid_by_partner: 0,
        included_expense_count: 0,
        draft_count: 0,
        truncated: false,
      }),
    );
    await fetchUnsettledBalance("user_abc");
    const [, options] = fetchMock.mock.calls[0];
    expect(options.cache).toBe("no-store");
  });

  test("AbortSignalを渡す(タイムアウト付き)", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        currency: "JPY",
        amount: 0,
        direction: "even",
        self: { member_id: "m1", display_name: "self" },
        partner: null,
        paid_by_self: 0,
        paid_by_partner: 0,
        included_expense_count: 0,
        draft_count: 0,
        truncated: false,
      }),
    );
    await fetchUnsettledBalance("user_abc");
    const [, options] = fetchMock.mock.calls[0];
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  test.each([
    [401, "unauthorized"],
    [403, "forbidden"],
    [400, "invalid_request"],
    [404, "not_found"],
    [429, "rate_limited"],
    [503, "server_not_configured"],
  ] as const)("HTTP %i は McpApiError(code=%s) にマッピングされる", async (status, code) => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: { code, message: `error ${status}` } }, { status }),
    );
    await expect(fetchUnsettledBalance("user_1")).rejects.toBeInstanceOf(McpApiError);
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: { code, message: `error ${status}` } }, { status }),
    );
    await expect(fetchUnsettledBalance("user_1")).rejects.toMatchObject({ status, code });
  });

  test("429のretry_after_secondsを拾う", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    // convex/http.tsの実レスポンス形はretry_after_secondsがerrorオブジェクトの
    // 内側ではなくトップレベルに乗る({ error: {...}, retry_after_seconds } の形)
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          error: { code: "rate_limited", message: "too many requests" },
          retry_after_seconds: 42,
        },
        { status: 429 },
      ),
    );
    await expect(fetchUnsettledBalance("user_1")).rejects.toMatchObject({
      code: "rate_limited",
      retryAfterSeconds: 42,
    });
  });

  test("JSONとして読めないエラーレスポンスはHTTPステータスからフォールバックする", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(new Response("not json", { status: 500 }));
    await expect(fetchUnsettledBalance("user_1")).rejects.toMatchObject({
      status: 500,
      code: "unknown_error",
    });
  });

  test("fetch自体が失敗(タイムアウト等)した場合はnetwork_errorに変換する", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    const timeoutError = new Error("The operation was aborted");
    timeoutError.name = "TimeoutError";
    fetchMock.mockRejectedValueOnce(timeoutError);
    await expect(fetchUnsettledBalance("user_1")).rejects.toMatchObject({
      code: "network_error",
    });
  });

  test("fetchExpenseListはクエリパラメータを組み立てる(limitは文字列化)", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ currency: "JPY", expenses: [], returned_count: 0, has_more: false, next_cursor: null }),
    );
    await fetchExpenseList(
      { filter: "all", date_from: "2026-08-01", date_to: "2026-08-31", cursor: "abc", limit: 10 },
      "user_1",
    );
    const [url] = fetchMock.mock.calls[0];
    const parsed = new URL(String(url));
    expect(parsed.pathname).toBe("/mcp/expenses");
    expect(parsed.searchParams.get("filter")).toBe("all");
    expect(parsed.searchParams.get("date_from")).toBe("2026-08-01");
    expect(parsed.searchParams.get("date_to")).toBe("2026-08-31");
    expect(parsed.searchParams.get("cursor")).toBe("abc");
    expect(parsed.searchParams.get("limit")).toBe("10");
  });

  test("fetchExpenseListは未指定のパラメータをURLに含めない", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ currency: "JPY", expenses: [], returned_count: 0, has_more: false, next_cursor: null }),
    );
    await fetchExpenseList({}, "user_1");
    const [url] = fetchMock.mock.calls[0];
    const parsed = new URL(String(url));
    expect(Array.from(parsed.searchParams.keys())).toEqual([]);
  });

  test("fetchMonthlySummaryはmonthをクエリに積む", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        currency: "JPY",
        month: "2026-08",
        included_expense_count: 0,
        draft_count: 0,
        total_amount: 0,
        settled_amount: 0,
        unsettled_amount: 0,
        unsettled_balance: { amount: 0, direction: "even" },
        members: [],
        truncated: false,
      }),
    );
    await fetchMonthlySummary("2026-08", "user_1");
    const [url] = fetchMock.mock.calls[0];
    const parsed = new URL(String(url));
    expect(parsed.pathname).toBe("/mcp/summary");
    expect(parsed.searchParams.get("month")).toBe("2026-08");
  });

  test("fetchExpenseBreakdownはidをクエリに積む", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        currency: "JPY",
        id: "e1",
        store_name: null,
        purchased_at: "2026-08-05",
        total_amount: 0,
        status: "confirmed",
        settled: false,
        source: "manual",
        paid_by: { member_id: "m1", display_name: "self" },
        advance_amount: 0,
        items: [],
      }),
    );
    await fetchExpenseBreakdown("e1", "user_1");
    const [url] = fetchMock.mock.calls[0];
    const parsed = new URL(String(url));
    expect(parsed.pathname).toBe("/mcp/expense");
    expect(parsed.searchParams.get("id")).toBe("e1");
  });
});
