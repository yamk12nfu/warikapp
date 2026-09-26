import { afterEach, describe, expect, it, vi } from "vitest";
import { parseAuthorizedParties } from "./authorized-parties";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("parseAuthorizedParties", () => {
  it("HTTP(S)の値をオリジンとして返す", () => {
    expect(parseAuthorizedParties("https://warikapp.example.com")).toEqual([
      "https://warikapp.example.com",
    ]);
    expect(
      parseAuthorizedParties(" https://Warikapp.Example.com:443/ "),
    ).toEqual(["https://warikapp.example.com"]);
    expect(parseAuthorizedParties("http://warikapp.example.com/path")).toEqual([
      "http://warikapp.example.com",
    ]);
  });

  it("カンマ区切りから有効なオリジンだけを順番どおり返す", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(
      parseAuthorizedParties(
        "https://first.example.com, , ftp://invalid.example.com, http://second.example.com,",
      ),
    ).toEqual([
      "https://first.example.com",
      "http://second.example.com",
    ]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("ftp://invalid.example.com");
  });

  it("HTTP(S)以外とスキームのない値を拒否して警告する", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const invalidEntries = [
      "ftp://x.example.com",
      "file:///etc/passwd",
      "javascript:alert(1)",
      "data:text/plain,x",
      "blob:https://a.example.com/uuid",
      "example.com",
    ];
    const rejectedValues = invalidEntries.flatMap((entry) => entry.split(","));

    for (const entry of invalidEntries) {
      expect(parseAuthorizedParties(`${entry},https://valid.example.com`)).toEqual([
        "https://valid.example.com",
      ]);
    }

    expect(warn).toHaveBeenCalledTimes(rejectedValues.length);
    for (const [index, entry] of rejectedValues.entries()) {
      expect(warn.mock.calls[index][0]).toContain(entry);
    }
  });

  it("すべて無効な設定や区切り文字だけの設定を警告する", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(parseAuthorizedParties("ftp://a, example.com")).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(3);
    expect(warn.mock.calls[2][0]).toContain("有効なオリジンが1つもない");

    warn.mockClear();
    expect(parseAuthorizedParties(",")).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("有効なオリジンが1つもない");
  });

  it("未設定または空文字列なら警告せず空配列を返す", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(parseAuthorizedParties(undefined)).toEqual([]);
    expect(parseAuthorizedParties("")).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
  });
});
