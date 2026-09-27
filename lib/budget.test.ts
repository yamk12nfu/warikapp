import { describe, expect, test } from "vitest";
import { budgetRatio, resolveBudgets, type BudgetRow } from "./budget";

describe("resolveBudgets", () => {
  test("前月に設定した全体・分類別予算を翌月へ引き継ぐ", () => {
    const rows: BudgetRow[] = [
      { month: "2026-07", amount: 90000 },
      { month: "2026-07", category: "food", amount: 30000 },
      { month: "2026-07", category: "daily", amount: 12000 },
    ];

    expect(resolveBudgets(rows, "2026-09")).toEqual({
      overall: 90000,
      categories: { food: 30000, daily: 12000 },
    });
  });

  test("後の月の設定は同じ分類だけを置き換える", () => {
    const rows: BudgetRow[] = [
      { month: "2026-07", amount: 90000 },
      { month: "2026-07", category: "food", amount: 30000 },
      { month: "2026-07", category: "daily", amount: 12000 },
      { month: "2026-09", category: "food", amount: 40000 },
    ];

    expect(resolveBudgets(rows, "2026-09")).toEqual({
      overall: 90000,
      categories: { food: 40000, daily: 12000 },
    });
  });

  test("金額0はその月から予算を解除する", () => {
    const rows: BudgetRow[] = [
      { month: "2026-07", amount: 90000 },
      { month: "2026-07", category: "food", amount: 30000 },
      { month: "2026-09", amount: 0 },
      { month: "2026-09", category: "food", amount: 0 },
    ];

    expect(resolveBudgets(rows, "2026-09")).toEqual({
      overall: null,
      categories: {},
    });
  });

  test("対象月より後の設定は適用しない", () => {
    const rows: BudgetRow[] = [
      { month: "2026-07", amount: 90000 },
      { month: "2026-07", category: "food", amount: 30000 },
      { month: "2026-10", amount: 100000 },
      { month: "2026-10", category: "food", amount: 50000 },
    ];

    expect(resolveBudgets(rows, "2026-09")).toEqual({
      overall: 90000,
      categories: { food: 30000 },
    });
  });
});

describe("budgetRatio", () => {
  test("支出を予算で割り、予算超過は1を超える", () => {
    expect(budgetRatio(15000, 30000)).toBe(0.5);
    expect(budgetRatio(36000, 30000)).toBe(1.2);
  });

  test("予算0では0を返す", () => {
    expect(budgetRatio(15000, 0)).toBe(0);
  });
});
