import { ConvexError } from "convex/values";
import { describe, expect, test } from "vitest";
import {
  configErrorMessage,
  describeError,
  requireApiKey,
  resolveModel,
  withCause,
} from "./config";

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

// 「設定を直せば解決する」エラーは、汎用の「読み取りに失敗しました」に
// 丸めずに原因を出す(丸めると、モデルID・キー・課金のどれか分からない)
describe("configErrorMessage", () => {
  test("モデルIDの問題(400/404)はRECEIPT_AI_MODELを案内する", () => {
    for (const status of [400, 404]) {
      const message = configErrorMessage(status, "gemini", "gemini-x");
      expect(message).toContain("gemini-x");
      expect(message).toContain("RECEIPT_AI_MODEL");
    }
  });

  test("キーの問題(401/403)はプロバイダごとのキー名を案内する", () => {
    expect(configErrorMessage(401, "gemini", "m")).toContain("GEMINI_API_KEY");
    expect(configErrorMessage(403, "claude", "m")).toContain(
      "ANTHROPIC_API_KEY",
    );
  });

  test("利用上限・残高不足(429)は課金設定を案内する", () => {
    expect(configErrorMessage(429, "gemini", "m")).toContain("課金設定");
  });

  test("一時的な障害(5xx)は汎用文言に任せる", () => {
    expect(configErrorMessage(500, "gemini", "m")).toBeNull();
    expect(configErrorMessage(503, "claude", "m")).toBeNull();
  });
});

// 画面用の文言に置き換えたエラーでも、ログには元のAPIエラーの情報が残ること。
// 残らないと、設定ミスの切り分け(モデルID・キー・課金)ができなくなる
describe("describeError", () => {
  test("HTTPステータスとAPI側の文言を出す", () => {
    const apiError = Object.assign(new Error("quota exhausted"), {
      name: "ApiError",
      status: 429,
    });
    const described = describeError(apiError);
    expect(described).toContain("error=ApiError");
    expect(described).toContain("status=429");
    expect(described).toContain("quota exhausted");
  });

  test("画面用の文言に置き換えても、元のエラーを cause から拾う", () => {
    const apiError = Object.assign(new Error("credits are depleted"), {
      name: "ApiError",
      status: 429,
    });
    const wrapped = withCause(new ConvexError("利用上限に達しました"), apiError);

    const described = describeError(wrapped);
    expect(described).toContain("利用上限に達しました");
    // ここが欠けると、原因(残高切れ)がログから消える
    expect(described).toContain("status=429");
    expect(described).toContain("credits are depleted");
  });

  test("Errorでないものが飛んできても落ちない", () => {
    expect(describeError("なにか")).toBe("error=unknown");
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
