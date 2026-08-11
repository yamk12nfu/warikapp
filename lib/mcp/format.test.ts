import { describe, expect, test } from "vitest";
import {
  buildBalanceSummaryText,
  buildExpenseListSummaryText,
  buildItemBreakdownSummaryText,
  buildMonthlySummaryText,
  buildTextContent,
  formatYenText,
  TEXT_CHARACTER_LIMIT,
  truncatedWarningText,
} from "./format";
import type {
  BalanceResponse,
  ExpenseBreakdownResponse,
  ListExpensesResponse,
  MonthlySummaryResponse,
} from "./schemas";

describe("formatYenText", () => {
  test("3桁区切りで円を付ける", () => {
    expect(formatYenText(3210)).toBe("3,210円");
  });

  test("0円も正しく表示する", () => {
    expect(formatYenText(0)).toBe("0円");
  });

  test("大きい金額も3桁区切りになる", () => {
    expect(formatYenText(1234567)).toBe("1,234,567円");
  });
});

describe("truncatedWarningText", () => {
  test("警告マークと『確定値として答えないこと』を含む", () => {
    const text = truncatedWarningText("未精算が200件を超えている");
    expect(text).toContain("⚠️");
    expect(text).toContain("確定値として答えないこと");
    expect(text).toContain("未精算が200件を超えている");
  });
});

describe("buildTextContent", () => {
  test("上限以内ならJSONをそのまま含める", () => {
    const text = buildTextContent("サマリー", { a: 1 });
    expect(text).toContain("サマリー");
    expect(text).toContain('"a": 1');
  });

  test("上限を超える場合はJSONを機械的に切らず要約に置き換える(不正JSONを作らない)", () => {
    // 25,000字を確実に超える巨大なstructuredContentを用意する
    const huge = { items: Array.from({ length: 5000 }, (_, i) => ({ id: i, name: "x".repeat(50) })) };
    const text = buildTextContent("サマリー", huge);
    expect(text.length).toBeLessThan(TEXT_CHARACTER_LIMIT);
    expect(text).toContain("structuredContent");
    // 置き換え後のテキストに壊れたJSON断片(閉じられていない波括弧の羅列など)が
    // 含まれていないことを、JSON.parseできる完全なJSONブロックが存在しないことで確認する
    expect(text).not.toContain('"items"');
  });

  test("ちょうど境界値でも壊れない", () => {
    const text = buildTextContent("s", { a: "x".repeat(TEXT_CHARACTER_LIMIT) });
    expect(() => text).not.toThrow();
  });
});

describe("buildBalanceSummaryText", () => {
  const base: BalanceResponse = {
    currency: "JPY",
    amount: 3210,
    direction: "partner_pays_self",
    self: { member_id: "m1", display_name: "かえで" },
    partner: { member_id: "m2", display_name: "たろう" },
    paid_by_self: 21000,
    paid_by_partner: 13000,
    included_expense_count: 12,
    draft_count: 0,
    truncated: false,
  };

  test("direction: partner_pays_selfのとき相手→自分の文言になる", () => {
    const text = buildBalanceSummaryText(base);
    expect(text).toContain("たろうがかえでに3,210円支払う");
  });

  test("even/partner nullのとき精算不要と案内する", () => {
    const text = buildBalanceSummaryText({
      ...base,
      amount: 0,
      direction: "even",
      partner: null,
    });
    expect(text).toContain("精算不要");
  });

  test("truncated:trueのとき警告文が先頭に付く", () => {
    const text = buildBalanceSummaryText({ ...base, truncated: true });
    expect(text).toContain("⚠️");
    expect(text).toContain("確定値として答えないこと");
  });

  test("draft_count>0のとき注記が付く", () => {
    const text = buildBalanceSummaryText({ ...base, draft_count: 2 });
    expect(text).toContain("未確定(draft)のレシートが2件");
  });
});

describe("buildExpenseListSummaryText", () => {
  const base: ListExpensesResponse = {
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
    returned_count: 1,
    has_more: false,
    next_cursor: null,
  };

  test("各支出の行を含む", () => {
    const text = buildExpenseListSummaryText(base);
    expect(text).toContain("オーケー 川崎");
    expect(text).toContain("4,321円");
    expect(text).toContain("id: e1");
  });

  test("has_more:trueのときnext_cursorの案内を含む", () => {
    const text = buildExpenseListSummaryText({ ...base, has_more: true, next_cursor: "abc123" });
    expect(text).toContain("abc123");
    expect(text).toContain("cursor");
  });

  test("has_more:falseのときnext_cursorの案内を含まない", () => {
    const text = buildExpenseListSummaryText(base);
    expect(text).not.toContain("続きがあります");
  });
});

describe("buildMonthlySummaryText", () => {
  const base: MonthlySummaryResponse = {
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
  };

  test("月・合計・unsettled_balanceを含む", () => {
    const text = buildMonthlySummaryText(base);
    expect(text).toContain("2026-08");
    expect(text).toContain("84,210円");
    expect(text).toContain("3,210円");
  });

  test("get_unsettled_balanceとの使い分けの注記を含む", () => {
    const text = buildMonthlySummaryText(base);
    expect(text).toContain("get_unsettled_balance");
  });

  test("truncated:trueのとき警告文が付く", () => {
    const text = buildMonthlySummaryText({ ...base, truncated: true });
    expect(text).toContain("⚠️");
  });
});

describe("buildItemBreakdownSummaryText", () => {
  const base: ExpenseBreakdownResponse = {
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
  };

  test("店名なしのときは(店名なし)と表示する", () => {
    const text = buildItemBreakdownSummaryText({ ...base, store_name: null });
    expect(text).toContain("(店名なし)");
  });

  test("品目と負担割合を含む", () => {
    const text = buildItemBreakdownSummaryText(base);
    expect(text).toContain("牛乳");
    expect(text).toContain("50%");
  });
});
