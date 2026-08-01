import { describe, expect, test } from "vitest";
import {
  distributeDifference,
  normalizeParsedReceipt,
  normalizePurchasedAt,
  sumItems,
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

describe("distributeDifference", () => {
  const items = [
    { name: "牛肉", price: 600, quantity: 1 },
    { name: "にんじん", price: 400, quantity: 1 },
  ];

  // 税別レシートの本命ケース。差額(消費税)を1行にまとめず各品目に乗せることで、
  // 税は品目ごとの負担区分にそのまま従う(TBD-003)
  test("差額を品目の金額比で配分する", () => {
    const result = distributeDifference(items, 1100); // 消費税10%
    expect(result.items).toEqual([
      { name: "牛肉", price: 660, quantity: 1 },
      { name: "にんじん", price: 440, quantity: 1 },
    ]);
    expect(result.distributed).toBe(true);
    expect(result.skipped).toBe(false);
  });

  test("差額がなければ品目はそのまま", () => {
    const result = distributeDifference(items, 1000);
    expect(result.items).toEqual(items);
    expect(result.distributed).toBe(false);
    expect(result.skipped).toBe(false);
  });

  // 品目ごとに割合を掛けて丸めると合計が1円ずれることがある。
  // 累積の目標値から逆算することで、合計は常にレシート金額と一致させる
  test("端数が出ても合計はレシートの金額とぴったり合う", () => {
    const odd = [
      { name: "A", price: 101, quantity: 1 },
      { name: "B", price: 101, quantity: 1 },
      { name: "C", price: 101, quantity: 1 },
    ];
    const result = distributeDifference(odd, 333);
    expect(sumItems(result.items)).toBe(333);
    // 誤差は1円以内で散る(全部を末尾に寄せたりしない)
    for (const item of result.items) {
      expect(Math.abs(item.price - 111)).toBeLessThanOrEqual(1);
    }
  });

  // 総額から値引きされるレシート。調整行方式では「マイナスの品目」が作れず
  // 諦めていたが、按分ならそのまま扱える
  test("差額がマイナス(値引き)でも配分できる", () => {
    const result = distributeDifference(items, 900);
    expect(result.items).toEqual([
      { name: "牛肉", price: 540, quantity: 1 },
      { name: "にんじん", price: 360, quantity: 1 },
    ]);
    expect(result.distributed).toBe(true);
  });

  test("1円未満に潰れる品目が出るときは配分せず印を返す", () => {
    // 金額は1円以上の整数(V-403)。中途半端に丸めると合計が合わなくなるので、
    // 画面で直してもらう
    const result = distributeDifference(
      [
        { name: "牛肉", price: 600, quantity: 1 },
        { name: "レジ袋", price: 1, quantity: 1 },
      ],
      100,
    );
    expect(result.items).toEqual([
      { name: "牛肉", price: 600, quantity: 1 },
      { name: "レジ袋", price: 1, quantity: 1 },
    ]);
    expect(result.skipped).toBe(true);
    expect(result.distributed).toBe(false);
  });

  test("配分先が無い・比率を決められないときは印を返す", () => {
    expect(distributeDifference([], 1000).skipped).toBe(true);
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
      distributed: false,
      distributionSkipped: false,
    });
  });

  // 「レシートとして読めたか」は品目の件数で判定する。合計金額だけ返ってきても
  // 配分先が無いので、金額だけの支出ができることはない
  test("品目が読めず合計金額だけ返ってきた場合は sourceItemCount が0", () => {
    const result = normalizeParsedReceipt(
      raw({ items: [], total_amount: 5000 }),
      TODAY,
    );
    expect(result.sourceItemCount).toBe(0);
    expect(result.items).toEqual([]);
  });

  // 税別レシート(品目が税抜、合計が税込)。差額を各品目に乗せるので、
  // 品目ごとの負担区分がそのまま税にも効く
  test("品目合計と合計金額のズレを各品目に配分する", () => {
    const result = normalizeParsedReceipt(raw({ total_amount: 1080 }), TODAY);
    expect(result.items).toEqual([
      { name: "牛肉", price: 648, quantity: 1 },
      { name: "にんじん", price: 432, quantity: 1 },
    ]);
    expect(sumItems(result.items)).toBe(1080);
    expect(result.distributed).toBe(true);
  });

  test("保存できない品目を捨てたぶんも残った品目に配分する", () => {
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
    // 合計は必ずレシートの金額に合わせる(捨てた品目のぶんが行方不明にならない)
    expect(result.items).toEqual([{ name: "牛肉", price: 1000, quantity: 1 }]);
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

  // 数量1のときは何も足さないので名前も触らない。触ると型番などを壊す
  test("数量1なら x1 で終わる品目名を壊さない", () => {
    const result = normalizeParsedReceipt(
      raw({
        items: [
          { name: "商品X1", price: 300, quantity: 1 },
          { name: "電池 x1", price: 200, quantity: 1 },
        ],
        total_amount: 500,
      }),
      TODAY,
    );
    expect(result.items.map((item) => item.name)).toEqual([
      "商品X1",
      "電池 x1",
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

  test("単価か行合計か判定できないときは行合計として扱い、差額を配分する", () => {
    const result = normalizeParsedReceipt(
      raw({
        items: [{ name: "牛乳", price: 150, quantity: 3 }],
        total_amount: 500, // 150 とも 450 とも一致しない
      }),
      TODAY,
    );
    expect(result.items).toEqual([{ name: "牛乳 ×3", price: 500, quantity: 1 }]);
    expect(sumItems(result.items)).toBe(500);
  });

  test("品目が多すぎる場合は上限の100件に切る", () => {
    const items = Array.from({ length: 120 }, (_, index) => ({
      name: `品目${index}`,
      price: 100,
      quantity: 1,
    }));
    const result = normalizeParsedReceipt(
      raw({ items, total_amount: 12_000 }),
      TODAY,
    );
    // 100件 = expenses.save の上限(V-402)。差額は行を増やさず配分する
    expect(result.items).toHaveLength(100);
    expect(sumItems(result.items)).toBe(12_000);
  });

  test("上限で切る前に捨てる行を除くので、有効な品目が目減りしない", () => {
    const items = [
      { name: "  ", price: 100, quantity: 1 }, // 捨てられる行
      ...Array.from({ length: 100 }, (_, index) => ({
        name: `品目${index}`,
        price: 100,
        quantity: 1,
      })),
    ];
    const result = normalizeParsedReceipt(
      raw({ items, total_amount: 10_000 }),
      TODAY,
    );
    // 先に100件で切っていると有効な品目が99件になってしまう
    expect(result.sourceItemCount).toBe(100);
    expect(result.items).toHaveLength(100);
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
