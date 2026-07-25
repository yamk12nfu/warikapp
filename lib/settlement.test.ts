import { describe, expect, test } from "vitest";
import { calcAdvanceAmount, calcTotalAmount } from "./settlement";
import type { ExpenseItemInput } from "./types";

const SELF = "self";
const PARTNER = "partner";

// 負担区分プリセットぶんの shares を組む(UIの折半/自分/相手に対応)
const split = () => [
  { memberId: SELF, ratioPercent: 50 },
  { memberId: PARTNER, ratioPercent: 50 },
];
const onlySelf = () => [{ memberId: SELF, ratioPercent: 100 }];
const onlyPartner = () => [{ memberId: PARTNER, ratioPercent: 100 }];

const item = (
  price: number,
  shares: ExpenseItemInput["shares"],
  quantity = 1,
): ExpenseItemInput => ({ name: "品目", price, quantity, shares });

describe("calcTotalAmount", () => {
  test("品目金額 × 数量の合計を返す", () => {
    expect(
      calcTotalAmount([item(1000, split()), item(150, split(), 3)]),
    ).toBe(1450);
  });

  test("品目が空なら0", () => {
    expect(calcTotalAmount([])).toBe(0);
  });
});

describe("calcAdvanceAmount", () => {
  test("折半: 支払者は相手の50%を立て替える", () => {
    expect(calcAdvanceAmount(SELF, [item(5000, split())])).toBe(2500);
  });

  test("自分(100:0): 支払者が全額負担なので立て替えは発生しない", () => {
    expect(calcAdvanceAmount(SELF, [item(5000, onlySelf())])).toBe(0);
  });

  test("相手(0:100): 全額が立て替えになる", () => {
    expect(calcAdvanceAmount(SELF, [item(5000, onlyPartner())])).toBe(5000);
  });

  test("カスタム70:30: 相手の割合ぶんだけ立て替える", () => {
    const shares = [
      { memberId: SELF, ratioPercent: 70 },
      { memberId: PARTNER, ratioPercent: 30 },
    ];
    expect(calcAdvanceAmount(SELF, [item(1000, shares)])).toBe(300);
  });

  test("端数は品目ごとに四捨五入する(合計を割るのではない)", () => {
    // 333円の折半は166.5 → 167。2品目なら 167+167=334(合計666の折半333ではない)
    expect(calcAdvanceAmount(SELF, [item(333, split())])).toBe(167);
    expect(calcAdvanceAmount(SELF, [item(333, split()), item(333, split())])).toBe(
      334,
    );
  });

  test("数量は金額に掛けてから割合を適用する", () => {
    expect(calcAdvanceAmount(SELF, [item(100, split(), 3)])).toBe(150);
  });

  test("支払者が相手のときは相手視点の立て替え額になる", () => {
    // 同じ支出でも支払者が変われば立て替える側が入れ替わる
    const items = [item(5000, split())];
    expect(calcAdvanceAmount(PARTNER, items)).toBe(2500);
  });

  test("支払者が shares に含まれない(負担0%)場合は全額が立て替えになる", () => {
    expect(calcAdvanceAmount(SELF, [item(4000, onlyPartner())])).toBe(4000);
  });

  test("品目ごとに負担区分が違う支出を合算する", () => {
    const items = [
      item(1000, split()), // 500
      item(2000, onlySelf()), // 0
      item(3000, onlyPartner()), // 3000
    ];
    expect(calcAdvanceAmount(SELF, items)).toBe(3500);
  });
});
