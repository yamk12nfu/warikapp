import { afterEach, describe, expect, test, vi } from "vitest";
import { GET, OPTIONS } from "./route";

// RFC 9728 protected resource metadataルートの統合テスト(計画書 §7.2)。
// protectedResourceHandlerClerk は NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY から
// authorization_servers を導出するだけで外部通信はしない(server-LW3xAm2Z.mjs の
// deriveFapiUrl参照)ため、.env.local の実キーに依存せず、
// 「pk_test_<base64url(`${domain}$`)>」形式の偽キーを組み立てて渡す。

// Clerkの公開鍵形式を模した偽キー(実在しないダミードメイン)を組み立てる。
// deriveFapiUrl は "pk_(test|live)_" を剥がしてbase64復号 → 末尾の "$" を除去する
// 実装なので、逆算すれば任意のダミードメインをauthorization_serversに埋め込める
function fakePublishableKey(domain: string): string {
  const encoded = btoa(`${domain}$`).replace(/=+$/, "");
  return `pk_test_${encoded}`;
}

const FAKE_DOMAIN = "valid-mcp-test.clerk.accounts.dev";
const FAKE_PUBLISHABLE_KEY = fakePublishableKey(FAKE_DOMAIN);

describe("GET /.well-known/oauth-protected-resource/mcp", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test("resource・authorization_servers・scopes_supportedを返す", async () => {
    vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", FAKE_PUBLISHABLE_KEY);

    const res = GET(
      new Request("https://warikapp.example.com/.well-known/oauth-protected-resource/mcp"),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      resource: string;
      authorization_servers: string[];
      scopes_supported: string[];
    };

    // resourceはリクエストのoriginから導出される(protectedResourceHandlerClerkの実装)
    expect(body.resource).toBe("https://warikapp.example.com");
    expect(body.authorization_servers).toEqual([`https://${FAKE_DOMAIN}`]);
    // email等は要求せず、scopes_supportedは"profile"のみ(計画書 §6.1)
    expect(body.scopes_supported).toEqual(["profile"]);
  });

  test("OPTIONSはCORSヘッダーを返す", () => {
    const res = OPTIONS();
    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(res.headers.get("Access-Control-Allow-Methods")).toContain("GET");
    expect(res.headers.get("Access-Control-Allow-Headers")).toBe("*");
  });
});
