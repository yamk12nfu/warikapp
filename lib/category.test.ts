import { describe, expect, test } from "vitest";
import {
  categoryLabel,
  isStoredCategoryId,
  normalizeCategory,
  toStoredCategory,
} from "./category";

describe("categoryLabel", () => {
  test("保存する分類は日本語ラベルを返す", () => {
    expect(categoryLabel("food")).toBe("食費");
    expect(categoryLabel("daily")).toBe("日用品");
    expect(categoryLabel("transport")).toBe("交通");
    expect(categoryLabel("housing")).toBe("住居・光熱");
    expect(categoryLabel("medical")).toBe("医療");
    expect(categoryLabel("leisure")).toBe("娯楽");
    expect(categoryLabel("other")).toBe("その他");
  });

  test("未分類はフィールドが無いときの表示名", () => {
    expect(categoryLabel("uncategorized")).toBe("未分類");
  });
});

describe("toStoredCategory", () => {
  test("未分類は保存しない", () => {
    expect(toStoredCategory("uncategorized")).toBeUndefined();
  });

  test("保存する分類はその id を返す", () => {
    expect(toStoredCategory("housing")).toBe("housing");
  });
});

describe("normalizeCategory", () => {
  test("null と undefined は未分類", () => {
    expect(normalizeCategory(null)).toBe("uncategorized");
    expect(normalizeCategory(undefined)).toBe("uncategorized");
  });

  test("保存する id はそのまま通す", () => {
    expect(normalizeCategory("medical")).toBe("medical");
  });

  test("未分類リテラルと未知の文字列は拒否する", () => {
    expect(() => normalizeCategory("uncategorized")).toThrow(
      /unknown category/,
    );
    expect(() => normalizeCategory("rent")).toThrow(/unknown category/);
  });
});

describe("isStoredCategoryId", () => {
  test("保存する id は通り、未分類リテラルは通さない", () => {
    expect(isStoredCategoryId("food")).toBe(true);
    expect(isStoredCategoryId("other")).toBe(true);
    expect(isStoredCategoryId("uncategorized")).toBe(false);
  });
});
