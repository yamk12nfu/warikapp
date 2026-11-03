import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  buildBalanceSummaryText,
  buildExpenseListSummaryText,
  buildItemBreakdownSummaryText,
  buildMonthlySummaryText,
  buildTextContent,
} from "@/lib/mcp/format";

// 実MCPクライアント(@modelcontextprotocol/client の Client + StreamableHTTPClientTransport)で
// app/mcp/route.ts の GET/POST/DELETE を叩くプロトコル疎通テスト。
//
// 実物: route.ts の配線(Origin検証 → withMcpAuth → verifyToken)、mcp-handler 2.x、
//       SDK v2(@modelcontextprotocol/server / client)、@clerk/mcp-tools の verifyClerkToken、
//       lib/mcp/tools・respond・format・schemas。
// モック: Clerk のトークン検証(@clerk/backend の authenticateRequest。Bearer値から
//         Clerkの検証結果を返す)と、Convexへのデータ取得(lib/mcp/client の fetch* 関数)だけ。
// ネットワークは使わない: transport の fetch を route のハンドラ直呼びに差し替える。
//
// claude.ai / Claude Code が今話す 2025 世代(versionNegotiation 既定の legacy)と、
// mcp-handler 2.x がネイティブに提供する 2026-07-28 世代(auto)の両方で同じ検証を回す。

const { authenticateRequestMock } = vi.hoisted(() => ({
  authenticateRequestMock: vi.fn(),
}));

vi.mock("@clerk/backend", () => ({
  createClerkClient: () => ({ authenticateRequest: authenticateRequestMock }),
}));

// Bearer値 → Clerk の機械トークン検証結果(toAuth() の戻り値)
const CLERK_AUTH_BY_TOKEN: Record<string, { userId: string; scopes: string[] }> = {
  "token-a": { userId: "user_a", scopes: ["profile", "email"] },
  "token-b": { userId: "user_b", scopes: ["profile", "email"] },
  "token-no-profile": { userId: "user_a", scopes: ["email"] },
};

const { FIXTURES } = vi.hoisted(() => ({
  FIXTURES: {
    balance: {
      currency: "JPY",
      amount: 3210,
      direction: "partner_pays_self",
      self: { member_id: "m1", display_name: "かえで" },
      partner: { member_id: "m2", display_name: "たろう" },
      paid_by_self: 21000,
      paid_by_partner: 13000,
      included_expense_count: 12,
      draft_count: 1,
      truncated: false,
      pending_settlement: null,
    },
    balanceB: {
      currency: "JPY",
      amount: 7000,
      direction: "self_pays_partner",
      self: { member_id: "m_b", display_name: "きゃろる" },
      partner: null,
      paid_by_self: 0,
      paid_by_partner: 7000,
      included_expense_count: 1,
      draft_count: 0,
      truncated: false,
      pending_settlement: null,
    },
    list: {
      currency: "JPY",
      expenses: [
        {
          id: "e1",
          title: "オーケー 川崎",
          purchased_at: "2026-08-05",
          total_amount: 4321,
          item_count: 8,
          source: "receipt",
          paid_by: { member_id: "m1", display_name: "かえで" },
          status: "confirmed",
          settled: false,
          settlement_state: "unsettled",
        },
      ],
      returned_count: 1,
      has_more: true,
      next_cursor: "cur_2",
    },
    summary: {
      currency: "JPY",
      month: "2026-08",
      included_expense_count: 23,
      draft_count: 1,
      total_amount: 84210,
      settled_amount: 30000,
      unsettled_amount: 54210,
      category_amounts: [{ category_id: "food", category_label: "食費", amount: 84210 }],
      unsettled_balance: { amount: 3210, direction: "partner_pays_self" },
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
    },
    breakdown: {
      currency: "JPY",
      id: "e1",
      store_name: "オーケー 川崎",
      purchased_at: "2026-08-05",
      total_amount: 4321,
      status: "confirmed",
      settled: true,
      settlement_state: "settled",
      source: "receipt",
      paid_by: { member_id: "m1", display_name: "かえで" },
      advance_amount: 2100,
      items: [
        {
          name: "牛乳",
          price: 258,
          quantity: 2,
          subtotal: 516,
          category_id: "food",
          category_label: "食費",
          shares: [{ member_id: "m1", display_name: "かえで", ratio_percent: 50, amount: 258 }],
        },
      ],
    },
  },
}));

vi.mock("@/lib/mcp/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/mcp/client")>();
  return {
    ...actual,
    fetchUnsettledBalance: vi.fn(async (clerkUserId: string) =>
      clerkUserId === "user_b" ? FIXTURES.balanceB : FIXTURES.balance,
    ),
    fetchExpenseList: vi.fn(async () => FIXTURES.list),
    fetchMonthlySummary: vi.fn(async () => FIXTURES.summary),
    fetchExpenseBreakdown: vi.fn(async () => FIXTURES.breakdown),
  };
});

import * as mcpClient from "@/lib/mcp/client";
import { DELETE, GET, POST } from "./route";

const HANDLERS: Record<string, (req: Request) => Promise<Response>> = { GET, POST, DELETE };
const MCP_URL = new URL("http://localhost:3000/mcp");

type Seen = { method: string; status: number; wwwAuthenticate: string | null };

// transport の fetch を route のハンドラ直呼びに差し替える(ネットワーク不使用)。
// 認証エラーの検証用に、各HTTP応答のステータスと WWW-Authenticate を記録する
function routeFetch(seen: Seen[]) {
  return async (input: string | URL, init?: RequestInit): Promise<Response> => {
    const req = new Request(input, init);
    const handler = HANDLERS[req.method];
    if (handler === undefined) throw new Error(`unexpected method ${req.method}`);
    const res = await handler(req);
    seen.push({
      method: req.method,
      status: res.status,
      wwwAuthenticate: res.headers.get("WWW-Authenticate"),
    });
    return res;
  };
}

const ERAS = [
  {
    era: "2025世代(legacy)",
    versionNegotiation: { mode: "legacy" as const },
    expectedEra: "legacy",
    expectedVersion: "2025-11-25",
  },
  {
    era: "2026-07-28世代(auto)",
    versionNegotiation: { mode: "auto" as const },
    expectedEra: "modern",
    expectedVersion: "2026-07-28",
  },
];

describe.each(ERAS)("実MCPクライアントでの疎通: $era", ({ versionNegotiation, expectedEra, expectedVersion }) => {
  const clients: Client[] = [];

  async function connect(token: string | undefined, seen: Seen[] = []) {
    const transport = new StreamableHTTPClientTransport(MCP_URL, {
      fetch: routeFetch(seen),
      requestInit:
        token === undefined ? undefined : { headers: { Authorization: `Bearer ${token}` } },
    });
    const client = new Client({ name: "vitest-client", version: "1.0.0" }, { versionNegotiation });
    clients.push(client);
    await client.connect(transport);
    return client;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    authenticateRequestMock.mockImplementation(async (req: Request) => {
      const token = req.headers.get("authorization")?.replace(/^Bearer /, "");
      const clerkAuth = token === undefined ? undefined : CLERK_AUTH_BY_TOKEN[token];
      if (clerkAuth === undefined) {
        return { status: "signed-out", toAuth: () => null };
      }
      return {
        status: "signed-in",
        toAuth: () => ({
          isAuthenticated: true,
          tokenType: "oauth_token",
          clientId: "client_1",
          ...clerkAuth,
        }),
      };
    });
  });

  afterEach(async () => {
    await Promise.all(clients.splice(0).map((client) => client.close()));
  });

  test("接続(initialize / server/discover)が成功し、toolsケイパビリティを返す", async () => {
    const client = await connect("token-a");
    expect(client.getProtocolEra()).toBe(expectedEra);
    expect(client.getNegotiatedProtocolVersion()).toBe(expectedVersion);
    expect(client.getServerCapabilities()?.tools).toBeDefined();
  });

  test("tools/list: 4ツールの名前・annotations・入出力スキーマ", async () => {
    const client = await connect("token-a");
    const { tools } = await client.listTools();
    const byName = Object.fromEntries(tools.map((tool) => [tool.name, tool]));

    expect(Object.keys(byName).sort()).toEqual([
      "get_item_breakdown",
      "get_unsettled_balance",
      "list_expenses",
      "monthly_summary",
    ]);
    for (const tool of tools) {
      expect(tool.description).toBeTruthy();
      expect(tool.annotations).toEqual({
        title: tool.title,
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      });
    }
    expect(byName.get_unsettled_balance.title).toBe("未精算差額を取得");
    expect(Object.keys(byName.get_unsettled_balance.inputSchema.properties ?? {})).toEqual([]);
    expect(Object.keys(byName.list_expenses.inputSchema.properties ?? {})).toEqual([
      "filter",
      "date_from",
      "date_to",
      "cursor",
      "limit",
    ]);
    expect(byName.list_expenses.inputSchema.required).toBeUndefined();
    expect(Object.keys(byName.monthly_summary.inputSchema.properties ?? {})).toEqual(["month"]);
    expect(byName.get_item_breakdown.inputSchema.required).toEqual(["expense_id"]);
    expect(byName.get_unsettled_balance.outputSchema?.required).toEqual(
      Object.keys(FIXTURES.balance),
    );
    expect(byName.list_expenses.outputSchema?.required).toEqual(Object.keys(FIXTURES.list));
    expect(byName.monthly_summary.outputSchema?.required).toEqual(Object.keys(FIXTURES.summary));
    expect(byName.get_item_breakdown.outputSchema?.required).toEqual(
      Object.keys(FIXTURES.breakdown),
    );
  });

  test.each([
    {
      name: "get_unsettled_balance",
      args: {},
      fixture: FIXTURES.balance,
      summary: () => buildBalanceSummaryText(FIXTURES.balance as never),
    },
    {
      name: "list_expenses",
      args: { date_from: "2026-08-01" },
      fixture: FIXTURES.list,
      summary: () => buildExpenseListSummaryText(FIXTURES.list as never),
    },
    {
      name: "monthly_summary",
      args: { month: "2026-08" },
      fixture: FIXTURES.summary,
      summary: () => buildMonthlySummaryText(FIXTURES.summary as never),
    },
    {
      name: "get_item_breakdown",
      args: { expense_id: "e1" },
      fixture: FIXTURES.breakdown,
      summary: () => buildItemBreakdownSummaryText(FIXTURES.breakdown as never),
    },
  ])("tools/call $name: structuredContent と text が変わらない", async ({ name, args, fixture, summary }) => {
    const client = await connect("token-a");
    const result = await client.callTool({ name, arguments: args });

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual(fixture);
    expect(result.content).toEqual([
      { type: "text", text: buildTextContent(summary(), fixture as Record<string, unknown>) },
    ]);
  });

  test("tools/call: Convex呼び出しに検証済みトークンのuserIdと引数が渡る", async () => {
    const client = await connect("token-a");
    await client.callTool({ name: "list_expenses", arguments: { date_from: "2026-08-01" } });
    await client.callTool({ name: "monthly_summary", arguments: { month: "2026-08" } });
    await client.callTool({ name: "get_item_breakdown", arguments: { expense_id: "e1" } });

    expect(mcpClient.fetchExpenseList).toHaveBeenCalledWith(
      { date_from: "2026-08-01", filter: "all" },
      "user_a",
    );
    expect(mcpClient.fetchMonthlySummary).toHaveBeenCalledWith("2026-08", "user_a");
    expect(mcpClient.fetchExpenseBreakdown).toHaveBeenCalledWith("e1", "user_a");
  });

  test("トークンなしは401(WWW-Authenticate に resource_metadata)で接続できない", async () => {
    const seen: Seen[] = [];
    await expect(connect(undefined, seen)).rejects.toThrow();

    expect(seen[0].status).toBe(401);
    expect(seen[0].wwwAuthenticate).toContain('error="invalid_token"');
    expect(seen[0].wwwAuthenticate).toContain(
      'resource_metadata="http://localhost:3000/.well-known/oauth-protected-resource/mcp"',
    );
    expect(authenticateRequestMock).not.toHaveBeenCalled();
  });

  test("profileスコープの無いトークンは403(insufficient_scope)で接続できない", async () => {
    const seen: Seen[] = [];
    await expect(connect("token-no-profile", seen)).rejects.toThrow();

    expect(seen[0].status).toBe(403);
    expect(seen[0].wwwAuthenticate).toContain('error="insufficient_scope"');
    expect(seen[0].wwwAuthenticate).toContain(
      'resource_metadata="http://localhost:3000/.well-known/oauth-protected-resource/mcp"',
    );
  });

  test("2ユーザーの並行呼び出しで、それぞれ自分のトークンのuserIdだけが使われる", async () => {
    const [clientA, clientB] = await Promise.all([connect("token-a"), connect("token-b")]);

    const [resultA, resultB] = await Promise.all([
      clientA.callTool({ name: "get_unsettled_balance", arguments: {} }),
      clientB.callTool({ name: "get_unsettled_balance", arguments: {} }),
    ]);

    expect(resultA.structuredContent).toEqual(FIXTURES.balance);
    expect(resultB.structuredContent).toEqual(FIXTURES.balanceB);
    const userIds = vi.mocked(mcpClient.fetchUnsettledBalance).mock.calls.map(([id]) => id);
    expect(userIds.sort()).toEqual(["user_a", "user_b"]);
  });
});

describe("GET / DELETE(認証通過後の扱い)", () => {
  beforeEach(() => {
    authenticateRequestMock.mockResolvedValue({
      status: "signed-in",
      toAuth: () => ({
        isAuthenticated: true,
        tokenType: "oauth_token",
        clientId: "client_1",
        userId: "user_a",
        scopes: ["profile"],
      }),
    });
  });

  test.each([
    ["GET", GET],
    ["DELETE", DELETE],
  ] as const)("%s は405(JSON-RPC形式のMethod Not Allowed)を返す", async (method, handler) => {
    const res = await handler(
      new Request(MCP_URL, {
        method,
        headers: { authorization: "Bearer token-a", accept: "text/event-stream" },
      }),
    );
    expect(res.status).toBe(405);
    expect(await res.json()).toMatchObject({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed." },
    });
  });

  test("GET でもトークンなしは401(認証が先に効く)", async () => {
    const res = await GET(new Request(MCP_URL, { method: "GET" }));
    expect(res.status).toBe(401);
  });
});
