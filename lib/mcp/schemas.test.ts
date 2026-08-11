import { describe, expect, test } from "vitest";
import {
  balanceOutputSchema,
  getItemBreakdownInputSchema,
  getItemBreakdownOutputSchema,
  listExpensesInputSchema,
  listExpensesOutputSchema,
  monthlySummaryInputSchema,
  monthlySummaryOutputSchema,
} from "./schemas";

describe("balanceOutputSchema", () => {
  test("計画書§4.3(1)の例に適合する", () => {
    const result = balanceOutputSchema.safeParse({
      currency: "JPY",
      amount: 3210,
      direction: "partner_pays_self",
      self: { member_id: "m1", display_name: "かえで" },
      partner: { member_id: "m2", display_name: "たろう" },
      paid_by_self: 21000,
      paid_by_partner: 13000,
      included_expense_count: 12,
      draft_count: 1,
      truncated: false,
    });
    expect(result.success).toBe(true);
  });

  test("partner: null を許容する(パートナー未参加)", () => {
    const result = balanceOutputSchema.safeParse({
      currency: "JPY",
      amount: 0,
      direction: "even",
      self: { member_id: "m1", display_name: "かえで" },
      partner: null,
      paid_by_self: 0,
      paid_by_partner: 0,
      included_expense_count: 0,
      draft_count: 0,
      truncated: false,
    });
    expect(result.success).toBe(true);
  });

  test("currencyがJPY以外だと失敗する", () => {
    const result = balanceOutputSchema.safeParse({
      currency: "USD",
      amount: 0,
      direction: "even",
      self: { member_id: "m1", display_name: "かえで" },
      partner: null,
      paid_by_self: 0,
      paid_by_partner: 0,
      included_expense_count: 0,
      draft_count: 0,
      truncated: false,
    });
    expect(result.success).toBe(false);
  });

  test("フィールド欠落は失敗する", () => {
    const result = balanceOutputSchema.safeParse({ currency: "JPY" });
    expect(result.success).toBe(false);
  });
});

describe("listExpensesInputSchema", () => {
  test("全省略(引数なし呼び出し)を許容する", () => {
    expect(listExpensesInputSchema.safeParse({}).success).toBe(true);
  });

  test("filterはunsettled/all以外を拒否する", () => {
    expect(listExpensesInputSchema.safeParse({ filter: "unsettled" }).success).toBe(true);
    expect(listExpensesInputSchema.safeParse({ filter: "all" }).success).toBe(true);
    expect(listExpensesInputSchema.safeParse({ filter: "settled" }).success).toBe(false);
  });

  test("date_from/date_toはYYYY-MM-DD形式のみ許容する(実在日の検証はConvex側)", () => {
    expect(listExpensesInputSchema.safeParse({ date_from: "2026-08-01" }).success).toBe(true);
    expect(listExpensesInputSchema.safeParse({ date_from: "2026/08/01" }).success).toBe(false);
    expect(listExpensesInputSchema.safeParse({ date_from: "26-08-01" }).success).toBe(false);
  });

  test("limitは1〜50の範囲外を拒否する", () => {
    expect(listExpensesInputSchema.safeParse({ limit: 1 }).success).toBe(true);
    expect(listExpensesInputSchema.safeParse({ limit: 50 }).success).toBe(true);
    expect(listExpensesInputSchema.safeParse({ limit: 0 }).success).toBe(false);
    expect(listExpensesInputSchema.safeParse({ limit: 51 }).success).toBe(false);
    expect(listExpensesInputSchema.safeParse({ limit: 20.5 }).success).toBe(false);
  });
});

describe("listExpensesOutputSchema", () => {
  test("計画書§4.3(2)の例に適合する", () => {
    const result = listExpensesOutputSchema.safeParse({
      currency: "JPY",
      expenses: [
        {
          id: "e1",
          title: "オーケー 川崎",
          purchased_at: "2026-08-05",
          total_amount: 4321,
          item_count: 8,
          source: "receipt",
          paid_by: { member_id: "m1", display_name: "かえで" },
          status: "confirmed",
          settled: false,
        },
      ],
      returned_count: 20,
      has_more: true,
      next_cursor: "opaque-cursor",
    });
    expect(result.success).toBe(true);
  });

  test("next_cursorはnullを許容する(最終ページ)", () => {
    const result = listExpensesOutputSchema.safeParse({
      currency: "JPY",
      expenses: [],
      returned_count: 0,
      has_more: false,
      next_cursor: null,
    });
    expect(result.success).toBe(true);
  });
});

describe("monthlySummaryInputSchema", () => {
  test("month省略を許容する(Next.js側でJSTの今月を補完する契約)", () => {
    expect(monthlySummaryInputSchema.safeParse({}).success).toBe(true);
  });

  test("YYYY-MM形式のみ許容する", () => {
    expect(monthlySummaryInputSchema.safeParse({ month: "2026-08" }).success).toBe(true);
    expect(monthlySummaryInputSchema.safeParse({ month: "2026-8" }).success).toBe(false);
    expect(monthlySummaryInputSchema.safeParse({ month: "2026/08" }).success).toBe(false);
  });
});

describe("monthlySummaryOutputSchema", () => {
  test("計画書§4.3(3)の例に適合する", () => {
    const result = monthlySummaryOutputSchema.safeParse({
      currency: "JPY",
      month: "2026-08",
      included_expense_count: 23,
      draft_count: 1,
      total_amount: 84210,
      settled_amount: 30000,
      unsettled_amount: 54210,
      unsettled_balance: { amount: 3210, direction: "partner_pays_self" },
      members: [
        {
          member_id: "m1",
          display_name: "かえで",
          is_self: true,
          paid_amount: 50000,
          share_amount: 42000,
          unsettled_paid_amount: 32000,
        },
      ],
      truncated: false,
    });
    expect(result.success).toBe(true);
  });
});

describe("getItemBreakdownInputSchema", () => {
  test("expense_idは必須", () => {
    expect(getItemBreakdownInputSchema.safeParse({}).success).toBe(false);
    expect(getItemBreakdownInputSchema.safeParse({ expense_id: "" }).success).toBe(false);
    expect(getItemBreakdownInputSchema.safeParse({ expense_id: "e1" }).success).toBe(true);
  });
});

describe("getItemBreakdownOutputSchema", () => {
  test("計画書§4.3(4)の例に適合する", () => {
    const result = getItemBreakdownOutputSchema.safeParse({
      currency: "JPY",
      id: "e1",
      store_name: "オーケー 川崎",
      purchased_at: "2026-08-05",
      total_amount: 4321,
      status: "confirmed",
      settled: true,
      source: "receipt",
      paid_by: { member_id: "m1", display_name: "かえで" },
      advance_amount: 2100,
      items: [
        {
          name: "牛乳",
          price: 258,
          quantity: 2,
          subtotal: 516,
          shares: [{ member_id: "m1", display_name: "かえで", ratio_percent: 50, amount: 258 }],
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  test("store_name: null を許容する", () => {
    const result = getItemBreakdownOutputSchema.safeParse({
      currency: "JPY",
      id: "e1",
      store_name: null,
      purchased_at: "2026-08-05",
      total_amount: 100,
      status: "draft",
      settled: false,
      source: "manual",
      paid_by: { member_id: "m1", display_name: "かえで" },
      advance_amount: 0,
      items: [],
    });
    expect(result.success).toBe(true);
  });
});
