import { beforeEach, describe, expect, test, vi } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { monthlySummaryOutputSchema } from "../schemas";
import { registerMonthlySummaryTool } from "./monthly-summary";

vi.mock("../client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../client")>();
  return { ...actual, fetchMonthlySummary: vi.fn() };
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

const VALID_SUMMARY = {
  currency: "JPY" as const,
  month: "2026-08",
  included_expense_count: 23,
  draft_count: 1,
  total_amount: 84210,
  settled_amount: 30000,
  unsettled_amount: 54210,
  unsettled_balance: { amount: 3210, direction: "partner_pays_self" as const },
  members: [
    {
      member_id: "m1",
      display_name: "かえで",
      is_self: true,
      paid_amount: 50000,
      share_amount: 42000,
      unsettled_paid_amount: 32000,
    },
  ],
  truncated: false,
};

describe("registerMonthlySummaryTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("ツール名・inputSchema・outputSchemaを登録する", () => {
    const { server, getCaptured } = createFakeServer();
    registerMonthlySummaryTool(server);
    const captured = getCaptured();
    expect(captured.name).toBe("monthly_summary");
    expect(captured.config.inputSchema).toBeDefined();
    expect(captured.config.outputSchema).toBeDefined();
  });

  test("month省略時はJSTの今月を補完してクライアントに渡す", async () => {
    const { fetchMonthlySummary } = await import("../client");
    const mock = fetchMonthlySummary as unknown as ReturnType<typeof vi.fn>;
    mock.mockResolvedValueOnce(VALID_SUMMARY);

    const { server, getCaptured } = createFakeServer();
    registerMonthlySummaryTool(server);
    const captured = getCaptured();
    await captured.handler({}, FAKE_EXTRA);

    expect(mock).toHaveBeenCalledTimes(1);
    const [monthArg, userIdArg] = mock.mock.calls[0];
    expect(monthArg).toMatch(/^\d{4}-\d{2}$/);
    expect(userIdArg).toBe("user_1");
  });

  test("monthを渡した場合はそのまま使う", async () => {
    const { fetchMonthlySummary } = await import("../client");
    const mock = fetchMonthlySummary as unknown as ReturnType<typeof vi.fn>;
    mock.mockResolvedValueOnce(VALID_SUMMARY);

    const { server, getCaptured } = createFakeServer();
    registerMonthlySummaryTool(server);
    const captured = getCaptured();
    await captured.handler({ month: "2026-01" }, FAKE_EXTRA);

    expect(mock).toHaveBeenCalledWith("2026-01", "user_1");
  });

  test("成功時: structuredContentがoutputSchemaに適合する", async () => {
    const { fetchMonthlySummary } = await import("../client");
    (fetchMonthlySummary as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(VALID_SUMMARY);

    const { server, getCaptured } = createFakeServer();
    registerMonthlySummaryTool(server);
    const captured = getCaptured();
    const result = (await captured.handler({ month: "2026-08" }, FAKE_EXTRA)) as {
      structuredContent: unknown;
      content: { text: string }[];
      isError?: boolean;
    };

    expect(result.isError).toBeUndefined();
    expect(monthlySummaryOutputSchema.safeParse(result.structuredContent).success).toBe(true);
    expect(result.content[0].text).toContain("get_unsettled_balance");
  });

  test("APIエラー時: isError:trueで返る", async () => {
    const { fetchMonthlySummary, McpApiError } = await import("../client");
    (fetchMonthlySummary as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new McpApiError(429, "rate_limited", "レート制限中", 10),
    );

    const { server, getCaptured } = createFakeServer();
    registerMonthlySummaryTool(server);
    const captured = getCaptured();
    const result = (await captured.handler({}, FAKE_EXTRA)) as { isError?: boolean; content: { text: string }[] };

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("時間をおいて再試行");
  });
});
