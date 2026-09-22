import { describe, expect, test } from "vitest";
import {
  categoryRatio,
  foldMonth,
  formatYearMonthLabel,
  monthDateRange,
  monthHref,
  nextBookMonth,
  parseBookMonth,
  parseYearMonth,
  requireYearMonth,
  shiftYearMonth,
  toMonthExpenseFact,
  trailingYearMonths,
  visibleCategories,
  type CategoryAmounts,
  type MonthExpenseFact,
  type MonthItemFact,
} from "./month-book";

const SELF = "self";
const PARTNER = "partner";

const month = requireYearMonth("2026-09");

const split = () => [
  { memberId: SELF, ratioPercent: 50 },
  { memberId: PARTNER, ratioPercent: 50 },
];

const onlySelf = () => [{ memberId: SELF, ratioPercent: 100 }];

const item = (
  price: number,
  shares: MonthItemFact["shares"],
  quantity = 1,
): MonthItemFact => ({ price, quantity, shares });

function fact(
  overrides: Partial<MonthExpenseFact> &
    Pick<MonthExpenseFact, "totalAmount" | "category" | "items">,
): MonthExpenseFact {
  return {
    purchasedAt: month,
    status: "confirmed",
    settled: false,
    paidBy: SELF,
    ...overrides,
  };
}

const zeroAmounts = (): CategoryAmounts => ({
  food: 0,
  daily: 0,
  transport: 0,
  housing: 0,
  medical: 0,
  leisure: 0,
  other: 0,
  uncategorized: 0,
});

describe("parseYearMonth", () => {
  test("実在する月だけを受ける", () => {
    expect(parseYearMonth("2026-09")).toBe("2026-09");
    expect(parseYearMonth("2026-13")).toBeNull();
    expect(parseYearMonth("2026-00")).toBeNull();
    expect(parseYearMonth("2026-9")).toBeNull();
    expect(parseYearMonth("2026-09-01")).toBeNull();
  });

  test("壊れた文字列は requireYearMonth が投げる", () => {
    expect(() => requireYearMonth("2026-13")).toThrow(/invalid year-month/);
  });
});

describe("parseBookMonth / nextBookMonth", () => {
  test("2000〜2100 の外は月次の月にしない", () => {
    expect(parseBookMonth("2000-01")).toBe("2000-01");
    expect(parseBookMonth("2100-12")).toBe("2100-12");
    expect(parseBookMonth("1999-12")).toBeNull();
    expect(parseBookMonth("2101-01")).toBeNull();
    expect(parseBookMonth("2026-13")).toBeNull();
  });

  test("今日の月以降には次がない", () => {
    const today = requireYearMonth("2026-09");
    expect(nextBookMonth(today, today)).toBeNull();
    expect(nextBookMonth(requireYearMonth("2026-10"), today)).toBeNull();
    expect(nextBookMonth(requireYearMonth("2026-08"), today)).toBe("2026-09");
  });
});

describe("shiftYearMonth / trailingYearMonths", () => {
  test("年をまたいでずらす", () => {
    expect(shiftYearMonth(requireYearMonth("2026-01"), -1)).toBe("2025-12");
    expect(shiftYearMonth(requireYearMonth("2026-12"), 1)).toBe("2027-01");
  });

  test("選択月で終わる6ヶ月を古い順に返す", () => {
    expect(trailingYearMonths(requireYearMonth("2026-03"))).toEqual([
      "2025-10",
      "2025-11",
      "2025-12",
      "2026-01",
      "2026-02",
      "2026-03",
    ]);
  });
});

describe("monthDateRange", () => {
  test("うるう年の2月は29日まで", () => {
    expect(monthDateRange(requireYearMonth("2024-02"))).toEqual({
      from: "2024-02-01",
      to: "2024-02-29",
    });
  });

  test("平年の2月は28日まで", () => {
    expect(monthDateRange(requireYearMonth("2026-02"))).toEqual({
      from: "2026-02-01",
      to: "2026-02-28",
    });
  });

  test("30日の月と12月の末日", () => {
    expect(monthDateRange(requireYearMonth("2026-04"))).toEqual({
      from: "2026-04-01",
      to: "2026-04-30",
    });
    expect(monthDateRange(requireYearMonth("2026-12"))).toEqual({
      from: "2026-12-01",
      to: "2026-12-31",
    });
  });
});

describe("monthHref / formatYearMonthLabel", () => {
  test("月ページのパスと見出し", () => {
    const september = requireYearMonth("2026-09");
    expect(monthHref(september)).toBe("/months/2026-09");
    expect(formatYearMonthLabel(september)).toBe("2026年9月");
    expect(formatYearMonthLabel(requireYearMonth("2026-10"))).toBe("2026年10月");
  });
});

describe("foldMonth", () => {
  test("下書きの金額は合計にも分類にも差額にも入らない", () => {
    const folded = foldMonth(
      month,
      [
        fact({
          status: "draft",
          totalAmount: 9999,
          category: "food",
          items: [item(9999, split())],
        }),
        fact({
          totalAmount: 1000,
          category: "daily",
          settled: true,
          items: [item(1000, split())],
        }),
      ],
      SELF,
      PARTNER,
    );

    expect(folded.draftCount).toBe(1);
    expect(folded.confirmedCount).toBe(1);
    expect(folded.totalAmount).toBe(1000);
    expect(folded.categoryAmounts.food).toBe(0);
    expect(folded.categoryAmounts.daily).toBe(1000);
    expect(folded.members).toEqual([
      {
        memberId: SELF,
        paidAmount: 1000,
        shareAmount: 500,
        unsettledPaidAmount: 0,
      },
      {
        memberId: PARTNER,
        paidAmount: 0,
        shareAmount: 500,
        unsettledPaidAmount: 0,
      },
    ]);
    expect(folded.unsettledBalance).toEqual({
      fromMemberId: null,
      toMemberId: null,
      amount: 0,
    });
  });

  test("分類の合計は totalAmount と一致する", () => {
    const folded = foldMonth(
      month,
      [
        fact({
          totalAmount: 5000,
          category: "food",
          settled: true,
          items: [item(5000, split())],
        }),
        fact({
          totalAmount: 2000,
          category: "daily",
          paidBy: PARTNER,
          items: [item(2000, split())],
        }),
        fact({
          totalAmount: 200,
          category: "uncategorized",
          paidBy: PARTNER,
          items: [item(200, [{ memberId: PARTNER, ratioPercent: 100 }])],
        }),
      ],
      SELF,
      PARTNER,
    );

    expect(folded.categoryAmounts).toEqual({
      ...zeroAmounts(),
      food: 5000,
      daily: 2000,
      uncategorized: 200,
    });
    const categorySum = Object.values(folded.categoryAmounts).reduce(
      (sum, amount) => sum + amount,
      0,
    );
    expect(categorySum).toBe(7200);
    expect(folded.totalAmount).toBe(7200);
    expect(folded.settledAmount).toBe(5000);
    expect(folded.unsettledAmount).toBe(2200);
    expect(folded.unsettledBalance).toEqual({
      fromMemberId: SELF,
      toMemberId: PARTNER,
      amount: 1000,
    });
  });

  test("負担額は品目ごとの四捨五入を足す", () => {
    // 333円の折半は品目ごとに167。2品目で334。合計666円を一度に割ると333になる。
    const folded = foldMonth(
      month,
      [
        fact({
          totalAmount: 666,
          category: "food",
          items: [item(333, split()), item(333, split())],
        }),
      ],
      SELF,
      PARTNER,
    );

    expect(folded.members[0]).toEqual({
      memberId: SELF,
      paidAmount: 666,
      shareAmount: 334,
      unsettledPaidAmount: 666,
    });
    expect(folded.members[1]).toEqual({
      memberId: PARTNER,
      paidAmount: 0,
      shareAmount: 334,
      unsettledPaidAmount: 0,
    });
    expect(folded.unsettledBalance).toEqual({
      fromMemberId: PARTNER,
      toMemberId: SELF,
      amount: 334,
    });
  });

  test("支出が無い月は0", () => {
    expect(foldMonth(month, [], SELF, PARTNER)).toEqual({
      month: "2026-09",
      confirmedCount: 0,
      draftCount: 0,
      totalAmount: 0,
      settledAmount: 0,
      unsettledAmount: 0,
      unsettledBalance: {
        fromMemberId: null,
        toMemberId: null,
        amount: 0,
      },
      members: [
        {
          memberId: SELF,
          paidAmount: 0,
          shareAmount: 0,
          unsettledPaidAmount: 0,
        },
        {
          memberId: PARTNER,
          paidAmount: 0,
          shareAmount: 0,
          unsettledPaidAmount: 0,
        },
      ],
      categoryAmounts: zeroAmounts(),
    });
  });

  test("パートナーがいない世帯は差額を持たない", () => {
    const folded = foldMonth(
      month,
      [
        fact({
          totalAmount: 1000,
          category: "transport",
          items: [item(1000, onlySelf())],
        }),
      ],
      SELF,
      null,
    );

    expect(folded.members).toEqual([
      {
        memberId: SELF,
        paidAmount: 1000,
        shareAmount: 1000,
        unsettledPaidAmount: 1000,
      },
    ]);
    expect(folded.unsettledBalance).toEqual({
      fromMemberId: null,
      toMemberId: null,
      amount: 0,
    });
    expect(folded.totalAmount).toBe(1000);
  });

  test("別の月の支出は投げる", () => {
    expect(() =>
      foldMonth(
        month,
        [
          fact({
            purchasedAt: requireYearMonth("2026-08"),
            totalAmount: 100,
            category: "food",
            items: [item(100, onlySelf())],
          }),
        ],
        SELF,
        PARTNER,
      ),
    ).toThrow(/2026-08/);
  });

  test("世帯の外が支払った支出は合計に入り、二人の支払額と差額には入らない", () => {
    const folded = foldMonth(
      month,
      [
        fact({
          paidBy: "stranger",
          totalAmount: 800,
          category: "other",
          items: [item(800, [{ memberId: "stranger", ratioPercent: 100 }])],
        }),
      ],
      SELF,
      PARTNER,
    );

    expect(folded.totalAmount).toBe(800);
    expect(folded.categoryAmounts.other).toBe(800);
    expect(folded.members).toEqual([
      {
        memberId: SELF,
        paidAmount: 0,
        shareAmount: 0,
        unsettledPaidAmount: 0,
      },
      {
        memberId: PARTNER,
        paidAmount: 0,
        shareAmount: 0,
        unsettledPaidAmount: 0,
      },
    ]);
    expect(folded.unsettledBalance).toEqual({
      fromMemberId: null,
      toMemberId: null,
      amount: 0,
    });
  });
});

describe("visibleCategories", () => {
  test("0円を除き、未分類を最後に置く", () => {
    expect(
      visibleCategories({
        ...zeroAmounts(),
        food: 0,
        daily: 3,
        other: 10,
        uncategorized: 5,
      }),
    ).toEqual([
      { id: "daily", label: "日用品", amount: 3 },
      { id: "other", label: "その他", amount: 10 },
      { id: "uncategorized", label: "未分類", amount: 5 },
    ]);
  });

  test("未分類が0円なら出さない", () => {
    expect(visibleCategories({ ...zeroAmounts(), food: 40 })).toEqual([
      { id: "food", label: "食費", amount: 40 },
    ]);
  });
});

describe("categoryRatio", () => {
  test("合計0円のときは0", () => {
    expect(categoryRatio(50, 0)).toBe(0);
  });

  test("金額の比を返す", () => {
    expect(categoryRatio(250, 1000)).toBe(0.25);
  });
});

describe("toMonthExpenseFact", () => {
  test("日付は月に切り、カテゴリ欠落は未分類、精算idの有無が settled", () => {
    const items = [item(1200, split())];
    const missing = toMonthExpenseFact({
      purchasedAt: "2026-09-15",
      status: "confirmed",
      paidBy: SELF,
      totalAmount: 1200,
      items,
    });
    expect(missing.purchasedAt).toBe("2026-09");
    expect(missing.category).toBe("uncategorized");
    expect(missing.settled).toBe(false);

    const stored = toMonthExpenseFact({
      purchasedAt: "2026-09-01",
      status: "draft",
      settlementId: "settlement-1",
      paidBy: PARTNER,
      totalAmount: 400,
      category: "leisure",
      items,
    });
    expect(stored.category).toBe("leisure");
    expect(stored.settled).toBe(true);
    expect(stored.status).toBe("draft");
    expect(stored.paidBy).toBe(PARTNER);
  });

  test("未知のカテゴリは拒否する", () => {
    expect(() =>
      toMonthExpenseFact({
        purchasedAt: "2026-09-01",
        status: "confirmed",
        paidBy: SELF,
        totalAmount: 100,
        category: "rent",
        items: [],
      }),
    ).toThrow(/unknown category/);
  });
});
