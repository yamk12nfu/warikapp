import { ConvexError } from "convex/values";
import { describe, expect, test } from "vitest";
import { requireApiKey, resolveModel } from "./config";

// プロバイダ設定の読み取り。AI呼び出しを伴わないのでここだけで検証できる。

describe("resolveModel", () => {
  test("未設定・空文字ならプロバイダの既定モデルを使う", () => {
    expect(resolveModel("gemini", undefined, "gemini-2.5-flash")).toBe(
      "gemini-2.5-flash",
    );
    expect(resolveModel("gemini", "   ", "gemini-2.5-flash")).toBe(
      "gemini-2.5-flash",
    );
  });

  test("プロバイダに合うモデルIDはそのまま使う(前後の空白は落とす)", () => {
    expect(resolveModel("gemini", " gemini-3.5-flash ", "gemini-2.5-flash")).toBe(
      "gemini-3.5-flash",
    );
    expect(resolveModel("claude", "claude-haiku-4-5", "claude-opus-5")).toBe(
      "claude-haiku-4-5",
    );
  });

  // RECEIPT_AI_MODEL は1つしかないので、プロバイダを切り替えたときに前の
  // モデルIDが残っていると噛み合わない。黙って既定値に落とすと
  // 「設定したのに効かない」になるため、はっきり止める
  test("プロバイダと噛み合わないモデルIDは設定ミスとして止める", () => {
    expect(() =>
      resolveModel("gemini", "claude-opus-5", "gemini-2.5-flash"),
    ).toThrow(ConvexError);
    expect(() =>
      resolveModel("claude", "gemini-2.5-flash", "claude-opus-5"),
    ).toThrow("RECEIPT_AI_PROVIDER");
  });
});

describe("requireApiKey", () => {
  test("設定されていればそのまま返す", () => {
    expect(requireApiKey("key-123", "GEMINI_API_KEY")).toBe("key-123");
  });

  test("未設定なら何を設定すればよいかを示して止める", () => {
    expect(() => requireApiKey(undefined, "GEMINI_API_KEY")).toThrow(
      "GEMINI_API_KEY",
    );
    expect(() => requireApiKey("  ", "ANTHROPIC_API_KEY")).toThrow(
      "ANTHROPIC_API_KEY",
    );
  });
});
