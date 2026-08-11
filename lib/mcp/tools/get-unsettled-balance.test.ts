import { beforeEach, describe, expect, test, vi } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { balanceOutputSchema } from "../schemas";
import { registerGetUnsettledBalanceTool } from "./get-unsettled-balance";

vi.mock("../client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../client")>();
  return { ...actual, fetchUnsettledBalance: vi.fn() };
});

// registerTool を呼び出すだけの簡易McpServer。実SDKのServerは使わず、
// 渡された(name, config, handler)を捕まえてハンドラを直接テストする
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

const VALID_BALANCE = {
  currency: "JPY" as const,
  amount: 3210,
  direction: "partner_pays_self" as const,
  self: { member_id: "m1", display_name: "かえで" },
  partner: { member_id: "m2", display_name: "たろう" },
  paid_by_self: 21000,
  paid_by_partner: 13000,
  included_expense_count: 12,
  draft_count: 0,
  truncated: false,
};

describe("registerGetUnsettledBalanceTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("ツール名・title・outputSchemaを登録する", () => {
    const { server, getCaptured } = createFakeServer();
    registerGetUnsettledBalanceTool(server);
    const captured = getCaptured();
    expect(captured.name).toBe("get_unsettled_balance");
    expect(captured.config.outputSchema).toBeDefined();
    expect(captured.config.annotations).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
  });

  test("成功時: structuredContentがoutputSchemaに適合し、TextContentにJSONが併記される", async () => {
    const { fetchUnsettledBalance } = await import("../client");
    (fetchUnsettledBalance as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(VALID_BALANCE);

    const { server, getCaptured } = createFakeServer();
    registerGetUnsettledBalanceTool(server);
    const captured = getCaptured();
    const result = (await captured.handler(FAKE_EXTRA)) as {
      structuredContent: unknown;
      content: { type: string; text: string }[];
      isError?: boolean;
    };

    expect(result.isError).toBeUndefined();
    expect(balanceOutputSchema.safeParse(result.structuredContent).success).toBe(true);
    expect(result.content[0].text).toContain('"amount": 3210');
  });

  test("APIエラー時: isError:trueかつ次の一手を含む", async () => {
    const { fetchUnsettledBalance, McpApiError } = await import("../client");
    (fetchUnsettledBalance as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new McpApiError(403, "forbidden", "世帯に未所属です"),
    );

    const { server, getCaptured } = createFakeServer();
    registerGetUnsettledBalanceTool(server);
    const captured = getCaptured();
    const result = (await captured.handler(FAKE_EXTRA)) as { isError?: boolean; content: { text: string }[] };

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("世帯に参加してから再接続");
  });
});
