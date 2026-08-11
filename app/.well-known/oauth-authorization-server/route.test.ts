import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { GET, OPTIONS } from "./route";

// RFC 8414 Authorization Server Metadataルート(旧仕様クライアント互換用)の
// 統合テスト(計画書 §7.2)。authServerMetadataHandlerClerk は
// `${fapiUrl}/.well-known/oauth-authorization-server` へ実際にfetchする実装
// (server.mjs の fetchClerkAuthorizationServerMetadata)なので、グローバルfetchを
// モックして外部通信を発生させない。fapiUrlはNEXT_PUBLIC_CLERK_PUBLISHABLE_KEYから
// 導出されるため、.env.local の実キーではなく偽キーを組み立てて渡す

function fakePublishableKey(domain: string): string {
  const encoded = btoa(`${domain}$`).replace(/=+$/, "");
  return `pk_test_${encoded}`;
}

const FAKE_DOMAIN = "valid-mcp-test.clerk.accounts.dev";
const FAKE_PUBLISHABLE_KEY = fakePublishableKey(FAKE_DOMAIN);

const FAKE_AS_METADATA = {
  issuer: `https://${FAKE_DOMAIN}`,
  authorization_endpoint: `https://${FAKE_DOMAIN}/oauth/authorize`,
  token_endpoint: `https://${FAKE_DOMAIN}/oauth/token`,
  jwks_uri: `https://${FAKE_DOMAIN}/.well-known/jwks.json`,
};

describe("GET /.well-known/oauth-authorization-server", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", FAKE_PUBLISHABLE_KEY);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(FAKE_AS_METADATA), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  test("ClerkのFAPIから取得したAS metadataをそのまま返す", async () => {
    const res = await GET();
    expect(res.status).toBe(200);

    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [calledUrl] = fetchMock.mock.calls[0];
    expect(String(calledUrl)).toBe(
      `https://${FAKE_DOMAIN}/.well-known/oauth-authorization-server`,
    );

    const body = (await res.json()) as typeof FAKE_AS_METADATA;
    expect(body).toEqual(FAKE_AS_METADATA);
  });

  test("OPTIONSはCORSヘッダーを返す", () => {
    const res = OPTIONS();
    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(res.headers.get("Access-Control-Allow-Methods")).toContain("GET");
    expect(res.headers.get("Access-Control-Allow-Headers")).toBe("*");
  });
});
