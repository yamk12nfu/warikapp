import { describe, expect, test } from "vitest";
import { checkOrigin } from "./origin";

describe("checkOrigin", () => {
  test("Originヘッダーが無いリクエストは通す(非ブラウザクライアント)", () => {
    expect(checkOrigin(null, "https://claude.ai")).toEqual({ allowed: true });
    // allowlist未設定でもOriginヘッダーが無ければ通る
    expect(checkOrigin(null, undefined)).toEqual({ allowed: true });
  });

  test("allowlistに完全一致するOriginは通す", () => {
    expect(
      checkOrigin("https://claude.ai", "http://localhost:3000,https://claude.ai"),
    ).toEqual({ allowed: true });
  });

  test("allowlistに無いOriginは403相当で拒否する", () => {
    const result = checkOrigin("https://evil.example.com", "https://claude.ai");
    expect(result.allowed).toBe(false);
  });

  test("allowlist未設定でOriginヘッダーがある場合は拒否する", () => {
    const result = checkOrigin("https://claude.ai", undefined);
    expect(result.allowed).toBe(false);
  });

  test("前後の空白・カンマ区切りを許容する", () => {
    expect(
      checkOrigin("https://claude.ai", " http://localhost:3000 , https://claude.ai "),
    ).toEqual({ allowed: true });
  });

  test("部分一致は拒否する(完全一致のみ許可)", () => {
    const result = checkOrigin("https://claude.ai.evil.com", "https://claude.ai");
    expect(result.allowed).toBe(false);
  });

  test("末尾スラッシュの有無は別のオリジンとして扱う(完全一致)", () => {
    const result = checkOrigin("https://claude.ai/", "https://claude.ai");
    expect(result.allowed).toBe(false);
  });
});
