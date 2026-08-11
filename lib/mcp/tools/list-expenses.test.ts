import { beforeEach, describe, expect, test, vi } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { listExpensesOutputSchema } from "../schemas";
import { registerListExpensesTool } from "./list-expenses";

vi.mock("../client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../client")>();
  return { ...actual, fetchExpenseList: vi.fn() };
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

const FAKE_EXTRA = { authInfo: { extra: { userId: "user_1" } } } as never;

const VALID_LIST = {
  currency: "JPY" as const,
  expenses: [
    {
      id: "e1",
      title: "オーケー 川崎",
      purchased_at: "2026-08-05",
      total_amount: 4321,
      item_count: 8,
      source: "receipt" as const,
      paid_by: { member_id: "m1", display_name: "かえで" },
      status: "confirmed" as const,
      settled: false,
    },
  ],
  returned_count: 1,
  has_more: false,
  next_cursor: null,
};

describe("registerListExpensesTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("ツール名・inputSchema・outputSchemaを登録する", () => {
    const { server, getCaptured } = createFakeServer();
    registerListExpensesTool(server);
    const captured = getCaptured();
    expect(captured.name).toBe("list_expenses");
    expect(captured.config.inputSchema).toBeDefined();
    expect(captured.config.outputSchema).toBeDefined();
  });

  test("成功時: structuredContentがoutputSchemaに適合し、引数がクライアントに渡る", async () => {
    const { fetchExpenseList } = await import("../client");
    const mock = fetchExpenseList as unknown as ReturnType<typeof vi.fn>;
    mock.mockResolvedValueOnce(VALID_LIST);

    const { server, getCaptured } = createFakeServer();
    registerListExpensesTool(server);
    const captured = getCaptured();
    const args = { filter: "all" as const, date_from: "2026-08-01" };
    const result = (await captured.handler(args, FAKE_EXTRA)) as {
      structuredContent: unknown;
      content: { text: string }[];
      isError?: boolean;
    };

    expect(result.isError).toBeUndefined();
    expect(listExpensesOutputSchema.safeParse(result.structuredContent).success).toBe(true);
    expect(result.content[0].text).toContain("オーケー 川崎");
    expect(mock).toHaveBeenCalledWith(args, "user_1");
  });

  test("APIエラー時: isError:trueで返る", async () => {
    const { fetchExpenseList, McpApiError } = await import("../client");
    (fetchExpenseList as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new McpApiError(400, "invalid_request", "cursorが不正です"),
    );

    const { server, getCaptured } = createFakeServer();
    registerListExpensesTool(server);
    const captured = getCaptured();
    const result = (await captured.handler({}, FAKE_EXTRA)) as { isError?: boolean; content: { text: string }[] };

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("cursorが不正です");
  });
});
