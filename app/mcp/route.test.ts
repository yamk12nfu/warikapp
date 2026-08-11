import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// app/mcp/route.ts の配線(Origin検証 → withMcpAuth → verifyToken)の統合テスト。
// mcp-handler本体・@modelcontextprotocol/sdkは実物を使い、Clerk側だけを
// モックする(計画書 §7.2)。verifyToken は route.ts 内で
// auth({ acceptsToken: "oauth_token" }) → verifyClerkToken(...) の順に呼ぶ薄い
// ラッパーなので、両方をモックして戻り値を制御する。
//
// ここでは「MCPプロトコルとして正しいリクエストを最後まで処理できるか」ではなく、
// 「Origin検証→認証の配線がこの順序・条件で機能するか」だけを検証する
// (実ツール呼び出しの成功パスは lib/mcp/tools/*.test.ts が別途カバーする)。

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(),
}));

vi.mock("@clerk/mcp-tools/next", () => ({
  verifyClerkToken: vi.fn(),
}));

import { POST } from "./route";

function makeRequest(options: { origin?: string; authorization?: string } = {}): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (options.origin !== undefined) {
    headers.origin = options.origin;
  }
  if (options.authorization !== undefined) {
    headers.authorization = options.authorization;
  }
  return new Request("http://localhost:3000/mcp", {
    method: "POST",
    headers,
    // ping相当のJSON-RPC本文。認証段階で弾かれる想定のテストでは中身まで
    // 読まれないが、mcp-handler側の事前パースに耐えるよう最低限の形にしておく
    body: JSON.stringify({ jsonrpc: "2.0", method: "ping", id: 1 }),
  });
}

describe("app/mcp/route ハンドラの配線", () => {
  beforeEach(async () => {
    const { auth } = await import("@clerk/nextjs/server");
    const { verifyClerkToken } = await import("@clerk/mcp-tools/next");
    (auth as unknown as ReturnType<typeof vi.fn>).mockReset();
    (verifyClerkToken as unknown as ReturnType<typeof vi.fn>).mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test("トークンなしは401", async () => {
    const { auth } = await import("@clerk/nextjs/server");
    const { verifyClerkToken } = await import("@clerk/mcp-tools/next");
    (auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ isAuthenticated: false });
    // Authorizationヘッダーが無いのでmcp-handlerはbearerToken=undefinedでverifyTokenを呼ぶ。
    // 実装のverifyClerkTokenもtoken未指定ならundefinedを返す挙動なので、それに揃える
    (verifyClerkToken as unknown as ReturnType<typeof vi.fn>).mockReturnValue(undefined);

    const res = await POST(makeRequest());
    expect(res.status).toBe(401);
  });

  test("verifyTokenがundefinedを返す(非OAuthトークン相当)は401、WWW-Authenticateにresource_metadataを含む", async () => {
    const { auth } = await import("@clerk/nextjs/server");
    const { verifyClerkToken } = await import("@clerk/mcp-tools/next");
    // Cookieセッション由来のClerk session token等、oauth_token以外を想定
    (auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ isAuthenticated: false });
    (verifyClerkToken as unknown as ReturnType<typeof vi.fn>).mockReturnValue(undefined);

    const res = await POST(makeRequest({ authorization: "Bearer not-an-oauth-token" }));
    expect(res.status).toBe(401);
    const wwwAuthenticate = res.headers.get("WWW-Authenticate");
    expect(wwwAuthenticate).not.toBeNull();
    expect(wwwAuthenticate).toContain("resource_metadata=");
    expect(wwwAuthenticate).toContain("/.well-known/oauth-protected-resource/mcp");
  });

  test("許可外Originは403(認証段階に到達しない)", async () => {
    const { auth } = await import("@clerk/nextjs/server");
    const { verifyClerkToken } = await import("@clerk/mcp-tools/next");
    vi.stubEnv("WARIKAPP_MCP_ALLOWED_ORIGINS", "https://claude.ai");

    const res = await POST(makeRequest({ origin: "https://evil.example.com" }));
    const body = (await res.json()) as { error: { code: string } };

    expect(res.status).toBe(403);
    expect(body.error.code).toBe("forbidden");
    // Origin検証で落ちているので、認証段階(auth/verifyClerkToken)まで進んでいない
    expect(auth).not.toHaveBeenCalled();
    expect(verifyClerkToken).not.toHaveBeenCalled();
  });

  test("許可Originは401より先に落ちない(通過して認証段階へ進む)", async () => {
    const { auth } = await import("@clerk/nextjs/server");
    const { verifyClerkToken } = await import("@clerk/mcp-tools/next");
    vi.stubEnv("WARIKAPP_MCP_ALLOWED_ORIGINS", "https://claude.ai");
    (auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ isAuthenticated: false });
    (verifyClerkToken as unknown as ReturnType<typeof vi.fn>).mockReturnValue(undefined);

    const res = await POST(makeRequest({ origin: "https://claude.ai" }));

    // トークンを渡していないので最終的には401になるが、403(Origin拒否)ではない
    // ことが「Origin検証を通過して認証段階へ進んだ」ことの証拠になる
    expect(res.status).toBe(401);
    expect(auth).toHaveBeenCalledTimes(1);
  });

  test("Originなしは通過する(非ブラウザクライアント)", async () => {
    const { auth } = await import("@clerk/nextjs/server");
    const { verifyClerkToken } = await import("@clerk/mcp-tools/next");
    vi.stubEnv("WARIKAPP_MCP_ALLOWED_ORIGINS", "https://claude.ai");
    (auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ isAuthenticated: false });
    (verifyClerkToken as unknown as ReturnType<typeof vi.fn>).mockReturnValue(undefined);

    const res = await POST(makeRequest());

    expect(res.status).toBe(401);
    expect(auth).toHaveBeenCalledTimes(1);
  });
});

// ==========================================================================
// スコープ検証(レビュー指摘 中1)
//
// requiredScopes: ["profile"] は mcp-handler@1.1.0 の withMcpAuth がネイティブに
// 検査する(InsufficientScopeError → 403 + WWW-Authenticate)。verifyClerkToken の
// 戻り値(AuthInfo)の scopes フィールドをそのまま見るので、ここでは
// verifyClerkToken のモックが返す scopes を変えるだけでよい。
// ==========================================================================

describe("app/mcp/route スコープ検証", () => {
  beforeEach(async () => {
    const { auth } = await import("@clerk/nextjs/server");
    const { verifyClerkToken } = await import("@clerk/mcp-tools/next");
    (auth as unknown as ReturnType<typeof vi.fn>).mockReset();
    (verifyClerkToken as unknown as ReturnType<typeof vi.fn>).mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test("profileスコープを含まないトークンは403(insufficient_scope)", async () => {
    const { auth } = await import("@clerk/nextjs/server");
    const { verifyClerkToken } = await import("@clerk/mcp-tools/next");
    (auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ isAuthenticated: true });
    (verifyClerkToken as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      token: "no-scope-token",
      scopes: [],
      clientId: "client_1",
      extra: { userId: "user_1" },
    });

    const res = await POST(makeRequest({ authorization: "Bearer no-scope-token" }));

    expect(res.status).toBe(403);
    const wwwAuthenticate = res.headers.get("WWW-Authenticate");
    expect(wwwAuthenticate).toContain("insufficient_scope");
  });

  test("profileスコープを含むトークンはスコープ検証を通過する(401/403にならない)", async () => {
    const { auth } = await import("@clerk/nextjs/server");
    const { verifyClerkToken } = await import("@clerk/mcp-tools/next");
    (auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ isAuthenticated: true });
    (verifyClerkToken as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      token: "profile-token",
      scopes: ["profile"],
      clientId: "client_1",
      extra: { userId: "user_1" },
    });

    const res = await POST(makeRequest({ authorization: "Bearer profile-token" }));

    // pingメソッドはツール呼び出しではないのでMCPプロトコルレベルでは処理されるが、
    // ここで確認したいのは認証・スコープ段階を通過したこと(401/403ではないこと)
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });
});

// ==========================================================================
// MCP成功パスの統合テスト(レビュー指摘 中5)
//
// mcp-handler本体・@modelcontextprotocol/sdkは実物を使い、Clerk側(auth /
// verifyClerkToken)とConvex内部APIへのfetch(lib/mcp/client.ts経由)だけを
// モックする。実際のJSON-RPC(initialize → tools/call)をPOST /mcpへ通し、
// structuredContentが返ることを検証する。
//
// mcp-handler@1.1.0のcreateMcpHandlerは既定でステートレスモード
// (sessionIdGeneratorを渡さない)で動くため、node_modules/@modelcontextprotocol/sdk/
// dist/esm/server/webStandardStreamableHttp.js の validateSession実装により
// セッションIDの発行・検証は行われない(initializeを経ずにtools/callを直接
// 送っても処理される)。レスポンスは既定でSSE形式(Content-Type:
// text/event-stream)になるため、Accept: application/json, text/event-stream を
// 送った上で「event: message\ndata: <json>\n\n」形式をパースする。
// ==========================================================================

describe("app/mcp/route MCP成功パスの統合テスト", () => {
  beforeEach(async () => {
    const { auth } = await import("@clerk/nextjs/server");
    const { verifyClerkToken } = await import("@clerk/mcp-tools/next");
    (auth as unknown as ReturnType<typeof vi.fn>).mockReset();
    (verifyClerkToken as unknown as ReturnType<typeof vi.fn>).mockReset();
    (auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ isAuthenticated: true });
    // 実装(verifyClerkTokenの実物)はuserIdをauth側から取るが、ここではテストの
    // 都合上bearerToken(=各リクエストのAuthorizationヘッダーから
    // mcp-handlerが取り出す、リクエストごとに正しく別々の値)からuserIdを
    // 導出する。並行呼び出しテストで「どちらのリクエストのuserIdが
    // Convex呼び出しヘッダーに載るか」を、認証コンテキストではなく
    // 明示的な引数の受け渡し(mcp-handler → verifyToken(req, bearerToken) →
    // verifyClerkToken(auth, bearerToken))だけで検証するため
    (verifyClerkToken as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (_clerkAuth: unknown, token?: string) => ({
        token,
        scopes: ["profile"],
        clientId: "client_1",
        extra: { userId: token === "token-b" ? "user_b" : "user_a" },
      }),
    );
    vi.stubEnv("WARIKAPP_CONVEX_SITE_URL", "https://convex.example.test");
    vi.stubEnv("WARIKAPP_MCP_INTERNAL_SECRET", "internal-secret");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  const ACCEPT_HEADER = "application/json, text/event-stream";

  function mcpRequest(body: unknown, authorization: string): Request {
    return new Request("http://localhost:3000/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: ACCEPT_HEADER,
        authorization,
      },
      body: JSON.stringify(body),
    });
  }

  // mcp-handlerの既定(SSE)応答本文("event: message\ndata: {...}\n\n")から
  // JSON-RPCメッセージを取り出す。Content-Typeがapplication/jsonの場合は
  // そのままJSONとして読む(mcp-handlerの設定変更やSDK側の将来変更に耐える)
  async function parseJsonRpcResponse(res: Response): Promise<{
    result?: { structuredContent?: unknown; protocolVersion?: string };
    error?: { message: string };
  }> {
    const contentType = res.headers.get("content-type") ?? "";
    const text = await res.text();
    if (contentType.includes("application/json")) {
      return JSON.parse(text);
    }
    const dataLine = text
      .split("\n")
      .find((line) => line.startsWith("data: "));
    if (dataLine === undefined) {
      throw new Error(`SSE応答にdata行が見つかりません: ${text}`);
    }
    return JSON.parse(dataLine.slice("data: ".length));
  }

  const BALANCE_BODY_A = {
    currency: "JPY",
    amount: 1500,
    direction: "partner_pays_self",
    self: { member_id: "m_a", display_name: "あきこ" },
    partner: { member_id: "m_a2", display_name: "ぼぶ" },
    paid_by_self: 1500,
    paid_by_partner: 0,
    included_expense_count: 1,
    draft_count: 0,
    truncated: false,
  };
  const BALANCE_BODY_B = {
    currency: "JPY",
    amount: 7000,
    direction: "self_pays_partner",
    self: { member_id: "m_b", display_name: "きゃろる" },
    partner: { member_id: "m_b2", display_name: "でいぶ" },
    paid_by_self: 0,
    paid_by_partner: 7000,
    included_expense_count: 1,
    draft_count: 0,
    truncated: false,
  };

  function stubFetchByClerkUserIdHeader(): ReturnType<typeof vi.fn> {
    const fetchMock = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      const headers = init?.headers as Headers;
      const clerkUserId = headers.get("X-Warikapp-Clerk-User-Id");
      const body = clerkUserId === "user_b" ? BALANCE_BODY_B : BALANCE_BODY_A;
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  test("initialize → tools/call が成功しstructuredContentが返る", async () => {
    stubFetchByClerkUserIdHeader();

    const initRes = await POST(
      mcpRequest(
        {
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2025-06-18",
            capabilities: {},
            clientInfo: { name: "vitest-client", version: "1.0.0" },
          },
        },
        "Bearer token-a",
      ),
    );
    expect(initRes.status).toBe(200);
    const initBody = await parseJsonRpcResponse(initRes);
    expect(initBody.error).toBeUndefined();

    const callRes = await POST(
      mcpRequest(
        {
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: { name: "get_unsettled_balance", arguments: {} },
        },
        "Bearer token-a",
      ),
    );
    expect(callRes.status).toBe(200);
    const callBody = await parseJsonRpcResponse(callRes);
    expect(callBody.error).toBeUndefined();
    expect(callBody.result?.structuredContent).toMatchObject(BALANCE_BODY_A);
  });

  test("異なるBearerトークンの並行呼び出しでも認証コンテキストが混線しない", async () => {
    const fetchMock = stubFetchByClerkUserIdHeader();

    const callTool = (authorization: string) =>
      POST(
        mcpRequest(
          {
            jsonrpc: "2.0",
            id: 1,
            method: "tools/call",
            params: { name: "get_unsettled_balance", arguments: {} },
          },
          authorization,
        ),
      ).then(parseJsonRpcResponse);

    const [resultA, resultB] = await Promise.all([
      callTool("Bearer token-a"),
      callTool("Bearer token-b"),
    ]);

    expect(resultA.result?.structuredContent).toMatchObject(BALANCE_BODY_A);
    expect(resultB.result?.structuredContent).toMatchObject(BALANCE_BODY_B);

    const seenUserIds = fetchMock.mock.calls.map(([, init]) => {
      const headers = (init as RequestInit).headers as Headers;
      return headers.get("X-Warikapp-Clerk-User-Id");
    });
    expect(new Set(seenUserIds)).toEqual(new Set(["user_a", "user_b"]));
  });
});
