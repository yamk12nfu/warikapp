import { describe, expect, test, vi } from "vitest";
import { McpApiError } from "./client";
import { getClerkUserId, toolErrorFromApiError, toolErrorFromUnknown, toolSuccess } from "./respond";

describe("toolSuccess", () => {
  test("structuredContentとJSON併記のTextContentを返す", () => {
    const result = toolSuccess("サマリー文", { a: 1 });
    expect(result.structuredContent).toEqual({ a: 1 });
    expect(result.content).toHaveLength(1);
    expect(result.content[0]).toMatchObject({ type: "text" });
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain("サマリー文");
    expect(text).toContain('"a": 1');
    expect(result.isError).toBeUndefined();
  });
});

describe("toolErrorFromApiError", () => {
  test("404はlist_expensesでの確認を促す次の一手を含む", () => {
    const result = toolErrorFromApiError(new McpApiError(404, "not_found", "支出が見つかりません"));
    expect(result.isError).toBe(true);
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain("list_expenses");
    expect(text).toContain("支出が見つかりません");
  });

  test("403は世帯参加を促す次の一手を含む", () => {
    const result = toolErrorFromApiError(new McpApiError(403, "forbidden", "権限がありません"));
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain("世帯に参加してから再接続");
  });

  test("429はretryAfterSecondsがあれば再試行タイミングを含む", () => {
    const result = toolErrorFromApiError(
      new McpApiError(429, "rate_limited", "レート制限中", 30),
    );
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain("時間をおいて再試行");
    expect(text).toContain("30秒後");
  });
});

describe("toolErrorFromUnknown", () => {
  test("McpApiErrorはtoolErrorFromApiErrorと同じ結果になる", () => {
    const error = new McpApiError(500, "unknown_error", "内部エラー");
    expect(toolErrorFromUnknown(error)).toEqual(toolErrorFromApiError(error));
  });

  test("それ以外の例外はisError:trueの汎用文言になり、詳細メッセージは露出しない", () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = toolErrorFromUnknown(new Error("boom"));
    expect(result.isError).toBe(true);
    const text = (result.content[0] as { text: string }).text;
    // レビュー指摘 中7: error.message(ここでは"boom")はクライアントに返さない。
    // URL・設定名等の内部情報が漏れないよう固定文言のみを返す
    expect(text).not.toContain("boom");
    expect(text).toContain("内部エラーが発生しました");
    expect(text).toContain("時間をおいて再試行");
    // 詳細はサーバーログにのみ出す
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.any(String), expect.any(Error));
    consoleErrorSpy.mockRestore();
  });
});

describe("getClerkUserId", () => {
  test("authInfo.extra.userIdを返す", () => {
    expect(getClerkUserId({ authInfo: { extra: { userId: "user_123" } } })).toBe("user_123");
  });

  test("userIdが無ければ例外を投げる", () => {
    expect(() => getClerkUserId({})).toThrow();
    expect(() => getClerkUserId({ authInfo: {} })).toThrow();
    expect(() => getClerkUserId({ authInfo: { extra: { userId: 123 } } })).toThrow();
  });
});
