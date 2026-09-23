import { describe, expect, test } from "vitest";
import { parseYearMonth } from "./month-book";
import {
  firstDayOf,
  monthInJst,
  nextMonth,
  postedExpenseFields,
} from "./fixed-cost";
import type { ShareRatio } from "./types";

const month = parseYearMonth("2026-12")!;
const shares: ShareRatio[] = [
  { memberId: "member-1", ratioPercent: 60 },
  { memberId: "member-2", ratioPercent: 40 },
];

describe("monthInJst", () => {
  test("UTC 15:00 を境に JST の月を切り替える", () => {
    expect(monthInJst(Date.parse("2026-08-31T14:59:59.999Z"))).toBe("2026-08");
    expect(monthInJst(Date.parse("2026-08-31T15:00:00.000Z"))).toBe("2026-09");
    expect(monthInJst(Date.parse("2026-12-31T14:59:59.999Z"))).toBe("2026-12");
    expect(monthInJst(Date.parse("2026-12-31T15:00:00.000Z"))).toBe("2027-01");
  });
});

describe("nextMonth and firstDayOf", () => {
  test("12月を翌年1月へ進め、月初日を返す", () => {
    expect(nextMonth(month)).toBe("2027-01");
    expect(firstDayOf(month)).toBe("2026-12-01");
  });
});

describe("postedExpenseFields", () => {
  test("固定費テンプレートから確定済みの手入力支出を組み立てる", () => {
    expect(
      postedExpenseFields(
        {
          _id: "fixed-cost-1",
          name: "家賃",
          amount: 120000,
          paidBy: "member-1",
          shares,
          category: "housing",
        },
        month,
      ),
    ).toEqual({
      paidBy: "member-1",
      purchasedAt: "2026-12-01",
      totalAmount: 120000,
      items: [{ name: "家賃", price: 120000, quantity: 1, shares }],
      category: "housing",
      source: "manual",
      status: "confirmed",
      fixedCost: { id: "fixed-cost-1", month: "2026-12" },
    });
  });

  test("分類なしのテンプレートは category を省略する", () => {
    const fields = postedExpenseFields(
      {
        _id: "fixed-cost-2",
        name: "会費",
        amount: 3000,
        paidBy: "member-1",
        shares,
      },
      month,
    );

    expect(Object.hasOwn(fields, "category")).toBe(false);
  });
});
