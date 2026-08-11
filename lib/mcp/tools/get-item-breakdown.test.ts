import { beforeEach, describe, expect, test, vi } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getItemBreakdownOutputSchema } from "../schemas";
import { registerGetItemBreakdownTool } from "./get-item-breakdown";

vi.mock("../client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../client")>();
  return { ...actual, fetchExpenseBreakdown: vi.fn() };
});

type FakeHandler = (...args: unknown[]) => unknown;

function createFakeServer() {
  let captured: { name: string; config: Record<string, unknown>; handler: FakeHandler } | undefined;
  const server = {
    registerTool: (name: string, config: Record<string, unknown>, handler: FakeHandler) => {
      captured = { name, config, handler };
    },
  } as unknown as McpServer;
  return {
    server,
    // registerTool呼び出し後に呼ぶこと(呼び出し前に評価すると未捕捉のまま例外になる)
    getCaptured() {
      if (captured === undefined) throw new Error("registerTool was not called");
      return captured;
    },
  };
}

const FAKE_EXTRA = { authInfo: { extra: { userId: "user_1" } } };

const VALID_BREAKDOWN = {
  currency: "JPY" as const,
  id: "e1",
  store_name: "オーケー 川崎",
  purchased_at: "2026-08-05",
  total_amount: 4321,
  status: "confirmed" as const,
  settled: true,
  source: "receipt" as const,
  paid_by: { member_id: "m1", display_name: "かえで" },
  advance_amount: 2100,
  items: [
    {
      name: "牛乳",
      price: 258,
      quantity: 2,
      subtotal: 516,
      shares: [{ member_id: "m1", display_name: "かえで", ratio_percent: 50, amount: 258 }],
    },
  ],
};

describe("registerGetItemBreakdownTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("ツール名・inputSchema・outputSchemaを登録する", () => {
    const { server, getCaptured } = createFakeServer();
    registerGetItemBreakdownTool(server);
    const captured = getCaptured();
    expect(captured.name).toBe("get_item_breakdown");
    expect(captured.config.inputSchema).toBeDefined();
    expect(captured.config.outputSchema).toBeDefined();
  });

  test("成功時: expense_idがクライアントに渡り、structuredContentがoutputSchemaに適合する", async () => {
    const { fetchExpenseBreakdown } = await import("../client");
    const mock = fetchExpenseBreakdown as unknown as ReturnType<typeof vi.fn>;
    mock.mockResolvedValueOnce(VALID_BREAKDOWN);

    const { server, getCaptured } = createFakeServer();
    registerGetItemBreakdownTool(server);
    const captured = getCaptured();
    const result = (await captured.handler({ expense_id: "e1" }, FAKE_EXTRA)) as {
      structuredContent: unknown;
      content: { text: string }[];
      isError?: boolean;
    };

    expect(mock).toHaveBeenCalledWith("e1", "user_1");
    expect(result.isError).toBeUndefined();
    expect(getItemBreakdownOutputSchema.safeParse(result.structuredContent).success).toBe(true);
    expect(result.content[0].text).toContain("牛乳");
  });

  test("404エラー時: isError:trueかつlist_expensesでの確認を促す", async () => {
    const { fetchExpenseBreakdown, McpApiError } = await import("../client");
    (fetchExpenseBreakdown as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new McpApiError(404, "not_found", "支出が見つかりません"),
    );

    const { server, getCaptured } = createFakeServer();
    registerGetItemBreakdownTool(server);
    const captured = getCaptured();
    const result = (await captured.handler({ expense_id: "unknown" }, FAKE_EXTRA)) as {
      isError?: boolean;
      content: { text: string }[];
    };

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("list_expenses");
  });
});
