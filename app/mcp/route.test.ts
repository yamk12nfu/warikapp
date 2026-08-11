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
