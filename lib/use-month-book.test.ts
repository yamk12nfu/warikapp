import { describe, expect, test } from "vitest";
import { requireYearMonth } from "./month-book";
import { toMonthPoint, type MonthSlice } from "./use-month-book";

describe("toMonthPoint", () => {
  test("未着は loading、超過は金額を持たない", () => {
    expect(toMonthPoint(undefined)).toEqual({ kind: "loading" });
    expect(toMonthPoint({ kind: "overflow", month: requireYearMonth("2026-09"), limit: 200 })).toEqual({
      kind: "overflow",
      limit: 200,
    });
  });

  test("exact は slice をそのまま渡す", () => {
    const slice = { totalAmount: 1200 } as MonthSlice;
    expect(toMonthPoint({ kind: "exact", slice })).toEqual({
      kind: "exact",
      slice,
    });
  });
});
