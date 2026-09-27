import { describe, expect, test } from "vitest";
import {
  categoryLabel,
  effectiveItemCategory,
  isStoredCategoryId,
  normalizeCategory,
  normalizeItemCategory,
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

describe("item category inheritance", () => {
  test("uses the expense category when the item has no override", () => {
    expect(effectiveItemCategory(undefined, "daily")).toBe("daily");
  });

  test("uses the item category when it overrides the expense", () => {
    expect(effectiveItemCategory("food", "daily")).toBe("food");
  });

  test("keeps an uncategorized expense uncategorized for an inherited item", () => {
    expect(effectiveItemCategory(undefined, "uncategorized")).toBe(
      "uncategorized",
    );
  });

  test("normalizes an override equal to the expense category to undefined", () => {
    expect(normalizeItemCategory("food", "food")).toBeUndefined();
  });

  test("keeps an override that differs from the expense category", () => {
    expect(normalizeItemCategory("food", "daily")).toBe("food");
  });

  test("keeps an uncategorized expense and inherited item undefined", () => {
    expect(normalizeItemCategory(undefined, "uncategorized")).toBeUndefined();
  });

  test(
    "支出に分類があると、品目は「未分類」にできない(undefined は分類を継承)",
    () => {
      expect(effectiveItemCategory(undefined, "daily")).toBe("daily");
    },
  );
});
