import { describe, expect, test } from "vitest";
import {
  ADJUSTMENT_ITEM_NAME,
  normalizeParsedReceipt,
  normalizePurchasedAt,
  sumItems,
  withAdjustmentItem,
  type RawParsedReceipt,
} from "./receipt";

const TODAY = "2026-07-26";

const raw = (overrides: Partial<RawParsedReceipt> = {}): RawParsedReceipt => ({
  store_name: "スーパーやまだ",
  purchased_at: "2026-07-20",
  total_amount: 1000,
  items: [
    { name: "牛肉", price: 600, quantity: 1 },
    { name: "にんじん", price: 200, quantity: 2 },
  ],
  ...overrides,
});

describe("withAdjustmentItem", () => {
  const items = [{ name: "牛肉", price: 600, quantity: 1 }];

  test("差額があれば「調整(税・割引等)」を末尾に足す", () => {
    const result = withAdjustmentItem(items, 660);
    expect(result.items).toHaveLength(2);
    expect(result.items[1]).toEqual({
      name: ADJUSTMENT_ITEM_NAME,
      price: 60,
      quantity: 1,
    });
    expect(result.droppedNegativeAdjustment).toBe(false);
    expect(sumItems(result.items)).toBe(660);
  });

  test("差額がなければ品目はそのまま", () => {
    const result = withAdjustmentItem(items, 600);
    expect(result.items).toEqual(items);
    expect(result.droppedNegativeAdjustment).toBe(false);
  });

  test("品目合計が合計金額を上回るときは調整行を作らず印を返す", () => {
    // 金額は1円以上の整数(V-403)なのでマイナスの調整行が作れない
    const result = withAdjustmentItem(items, 500);
    expect(result.items).toEqual(items);
    expect(result.droppedNegativeAdjustment).toBe(true);
  });
});

describe("normalizePurchasedAt", () => {
  test("妥当な過去日はそのまま", () => {
    expect(normalizePurchasedAt("2026-07-20", TODAY)).toBe("2026-07-20");
  });

  test("当日は許容する", () => {
    expect(normalizePurchasedAt(TODAY, TODAY)).toBe(TODAY);
  });

  test("未来日・実在しない日・書式違い・nullはnull", () => {
    expect(normalizePurchasedAt("2026-07-27", TODAY)).toBeNull();
    expect(normalizePurchasedAt("2026-02-31", TODAY)).toBeNull();
    expect(normalizePurchasedAt("2026/07/20", TODAY)).toBeNull();
    expect(normalizePurchasedAt(null, TODAY)).toBeNull();
  });
});

describe("normalizeParsedReceipt", () => {
  test("そのまま保存できる形に整える", () => {
    const result = normalizeParsedReceipt(raw(), TODAY);
    expect(result).toEqual({
      storeName: "スーパーやまだ",
      purchasedAt: "2026-07-20",
      totalAmount: 1000,
      items: [
        { name: "牛肉", price: 600, quantity: 1 },
        { name: "にんじん", price: 200, quantity: 2 },
      ],
      droppedNegativeAdjustment: false,
    });
  });

  test("品目合計と合計金額のズレを調整行が吸収する", () => {
    const result = normalizeParsedReceipt(raw({ total_amount: 1080 }), TODAY);
    expect(result.items.at(-1)).toEqual({
      name: ADJUSTMENT_ITEM_NAME,
      price: 80,
      quantity: 1,
    });
    expect(sumItems(result.items)).toBe(1080);
  });

  test("保存できない品目は捨て、その差額も調整行が吸収する", () => {
    const result = normalizeParsedReceipt(
      raw({
        items: [
          { name: "牛肉", price: 600, quantity: 1 },
          { name: "  ", price: 300, quantity: 1 }, // 名前が空
          { name: "レジ袋", price: 0, quantity: 1 }, // 1円未満
        ],
        total_amount: 1000,
      }),
      TODAY,
    );
    expect(result.items).toEqual([
      { name: "牛肉", price: 600, quantity: 1 },
      { name: ADJUSTMENT_ITEM_NAME, price: 400, quantity: 1 },
    ]);
  });

  test("数量と品目名を保存可能な範囲に丸める", () => {
    const result = normalizeParsedReceipt(
      raw({
        items: [
          { name: "あ".repeat(60), price: 100.4, quantity: 0 },
          { name: "たまご", price: 200, quantity: 1200 },
        ],
        total_amount: 0, // 読めなかった場合は品目合計で代用する
      }),
      TODAY,
    );
    expect(result.items[0]).toEqual({
      name: "あ".repeat(50),
      price: 100,
      quantity: 1,
    });
    expect(result.items[1].quantity).toBe(999);
    // 合計が読めなければ品目合計になるので調整行は増えない
    expect(result.items).toHaveLength(2);
    expect(result.totalAmount).toBe(sumItems(result.items));
  });

  test("品目が多すぎる場合は99件に切って調整行のぶんを空ける", () => {
    const items = Array.from({ length: 120 }, (_, index) => ({
      name: `品目${index}`,
      price: 100,
      quantity: 1,
    }));
    const result = normalizeParsedReceipt(
      raw({ items, total_amount: 12_000 }),
      TODAY,
    );
    // 99件 + 調整行1件 = 100件(expenses.save の上限)
    expect(result.items).toHaveLength(100);
    expect(sumItems(result.items)).toBe(12_000);
  });

  test("店名の空白のみ・購入日の判読不能はnullにする", () => {
    const result = normalizeParsedReceipt(
      raw({ store_name: "   ", purchased_at: null }),
      TODAY,
    );
    expect(result.storeName).toBeNull();
    expect(result.purchasedAt).toBeNull();
  });
});
