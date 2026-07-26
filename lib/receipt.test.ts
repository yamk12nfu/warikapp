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
    { name: "にんじん", price: 400, quantity: 1 },
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
    expect(result.adjustmentSkipped).toBe(false);
    expect(sumItems(result.items)).toBe(660);
  });

  test("差額がなければ品目はそのまま", () => {
    const result = withAdjustmentItem(items, 600);
    expect(result.items).toEqual(items);
    expect(result.adjustmentSkipped).toBe(false);
  });

  test("品目合計が合計金額を上回るときは調整行を作らず印を返す", () => {
    // 金額は1円以上の整数(V-403)なのでマイナスの調整行が作れない
    const result = withAdjustmentItem(items, 500);
    expect(result.items).toEqual(items);
    expect(result.adjustmentSkipped).toBe(true);
  });

  test("差額が金額の上限を超えるときも調整行を作らない", () => {
    // 作ってしまうと expenses.save が必ず弾く(V-403)ので、印だけ返す
    const result = withAdjustmentItem(items, 20_000_000);
    expect(result.items).toEqual(items);
    expect(result.adjustmentSkipped).toBe(true);
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
        { name: "にんじん", price: 400, quantity: 1 },
      ],
      sourceItemCount: 2,
      adjustmentSkipped: false,
    });
  });

  // 「レシートとして読めたか」は調整行を足す前の件数で判定する。
  // items で見ると、品目0件でも合計金額だけ返ってきたときに
  // 調整行だけの支出ができてしまう
  test("品目が読めず合計金額だけ返ってきた場合は sourceItemCount が0", () => {
    const result = normalizeParsedReceipt(
      raw({ items: [], total_amount: 5000 }),
      TODAY,
    );
    expect(result.sourceItemCount).toBe(0);
    expect(result.items).toEqual([
      { name: ADJUSTMENT_ITEM_NAME, price: 5000, quantity: 1 },
    ]);
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
    // 数量は上限999に丸めたうえで品目名へ畳み込む(名前は50文字以内に収める)
    expect(result.items[1].name).toBe("たまご ×999");
    expect(result.items[1].name.length).toBeLessThanOrEqual(50);
    // 合計が読めなければ品目合計になるので調整行は増えない
    expect(result.items).toHaveLength(2);
    expect(result.totalAmount).toBe(sumItems(result.items));
  });

  // 数量は仕分けUIに入力欄が無く、残すと「画面に出ない値」が合計に効いてしまう。
  // 常に1へ畳み込み、数量は品目名に残す
  test("数量は常に1に畳み込み、品目名に残す", () => {
    const result = normalizeParsedReceipt(
      raw({
        items: [{ name: "牛乳", price: 450, quantity: 3 }],
        total_amount: 450,
      }),
      TODAY,
    );
    expect(result.items).toEqual([
      { name: "牛乳 ×3", price: 450, quantity: 1 },
    ]);
  });

  // AIは数量を品目名に含めたり含めなかったりする。含んでいるのに足すと
  // 「牛乳 x2 ×2」のように二重になる(実レシートで発生した)。
  // いったん外して付け直すので、表記も「×N」に揃う
  test("品目名に数量が入っている場合は重ねて付けない", () => {
    const result = normalizeParsedReceipt(
      raw({
        items: [
          { name: "牛乳 1000ml x2", price: 396, quantity: 2 },
          { name: "たまご ×3", price: 300, quantity: 3 },
        ],
        total_amount: 696,
      }),
      TODAY,
    );
    expect(result.items.map((item) => item.name)).toEqual([
      "牛乳 1000ml ×2",
      "たまご ×3",
    ]);
  });

  // 切り詰めで数量だけが落ちると、quantityは1にしてあるので情報が完全に消える。
  // 品目名は「略称を正式名に展開する」よう指示しているので長くなりうる
  test("品目名が長くても数量は必ず残す", () => {
    const longName = `${"あ".repeat(60)} x2`;
    const result = normalizeParsedReceipt(
      raw({ items: [{ name: longName, price: 500, quantity: 2 }], total_amount: 500 }),
      TODAY,
    );
    const name = result.items[0].name;
    expect(name.endsWith(" ×2")).toBe(true);
    expect(name.length).toBeLessThanOrEqual(50);
  });

  test("単価で返ってきた場合は合計金額と突き合わせて行合計に直す", () => {
    const result = normalizeParsedReceipt(
      raw({
        // 150円×3 = 450 で合計と一致する = price は単価だった
        items: [{ name: "牛乳", price: 150, quantity: 3 }],
        total_amount: 450,
      }),
      TODAY,
    );
    expect(result.items).toEqual([
      { name: "牛乳 ×3", price: 450, quantity: 1 },
    ]);
    // 数量ぶんの二重計上も取りこぼしも起きない
    expect(sumItems(result.items)).toBe(450);
  });

  test("単価か行合計か判定できないときは行合計として扱い、差額は調整行が吸収する", () => {
    const result = normalizeParsedReceipt(
      raw({
        items: [{ name: "牛乳", price: 150, quantity: 3 }],
        total_amount: 500, // 150 とも 450 とも一致しない
      }),
      TODAY,
    );
    expect(result.items).toEqual([
      { name: "牛乳 ×3", price: 150, quantity: 1 },
      { name: ADJUSTMENT_ITEM_NAME, price: 350, quantity: 1 },
    ]);
    expect(sumItems(result.items)).toBe(500);
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

  test("上限で切る前に捨てる行を除くので、有効な品目が目減りしない", () => {
    const items = [
      { name: "  ", price: 100, quantity: 1 }, // 捨てられる行
      ...Array.from({ length: 99 }, (_, index) => ({
        name: `品目${index}`,
        price: 100,
        quantity: 1,
      })),
    ];
    const result = normalizeParsedReceipt(
      raw({ items, total_amount: 9900 }),
      TODAY,
    );
    // 先に99件で切っていると有効な品目が98件になってしまう
    expect(result.sourceItemCount).toBe(99);
    expect(result.items).toHaveLength(99); // 差額0なので調整行は増えない
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
