import {
  CATEGORIES,
  categoryLabel,
  normalizeCategory,
  type CategoryId,
} from "./category";
import {
  calcItemShareAmount,
  calcNetBalance,
  type SettlementBalance,
  type SettlementExpenseInput,
} from "./settlement";
import type { ExpenseItemInput } from "./types";

declare const yearMonthBrand: unique symbol;

export type YearMonth = string & { readonly [yearMonthBrand]: "YearMonth" };

export const MAX_MONTH_EXPENSES = 200;

export type MonthWindow = readonly [
  YearMonth,
  YearMonth,
  YearMonth,
  YearMonth,
  YearMonth,
  YearMonth,
];

export const MONTH_BOOK_WINDOW = 6 satisfies MonthWindow["length"];

export type MonthItemFact = {
  price: number;
  quantity: number;
  shares: ReadonlyArray<{ memberId: string; ratioPercent: number }>;
};

export type MonthExpenseFact = {
  purchasedAt: YearMonth;
  status: "draft" | "confirmed";
  settled: boolean;
  paidBy: string;
  totalAmount: number;
  category: CategoryId;
  items: ReadonlyArray<MonthItemFact>;
};

export type FoldMember = {
  memberId: string;
  paidAmount: number;
  shareAmount: number;
  unsettledPaidAmount: number;
};

export type CategoryAmounts = Record<CategoryId, number>;

export type HouseholdFold =
  | readonly [FoldMember]
  | readonly [FoldMember, FoldMember];

export type FoldedMonth = {
  month: YearMonth;
  confirmedCount: number;
  draftCount: number;
  totalAmount: number;
  settledAmount: number;
  unsettledAmount: number;
  unsettledBalance: SettlementBalance;
  members: HouseholdFold;
  categoryAmounts: CategoryAmounts;
};

export type CategorySlice = {
  id: CategoryId;
  label: string;
  amount: number;
};

const YEAR_MONTH = /^\d{4}-(?:0[1-9]|1[0-2])$/;

export function parseYearMonth(raw: string): YearMonth | null {
  if (!YEAR_MONTH.test(raw)) {
    return null;
  }
  return raw as YearMonth;
}

// Date.UTC は年 0〜99 を 1900〜1999 と読む。monthDateRange に渡す前にここで切る。
export const BOOK_YEAR_MIN = 2000;
export const BOOK_YEAR_MAX = 2100;

export function parseBookMonth(raw: string): YearMonth | null {
  const month = parseYearMonth(raw);
  if (month === null) {
    return null;
  }
  const year = Number(month.slice(0, 4));
  if (year < BOOK_YEAR_MIN || year > BOOK_YEAR_MAX) {
    return null;
  }
  return month;
}

export function nextBookMonth(
  anchor: YearMonth,
  todayMonth: YearMonth,
): YearMonth | null {
  if (anchor >= todayMonth) {
    return null;
  }
  return shiftYearMonth(anchor, 1);
}

export function requireYearMonth(raw: string): YearMonth {
  const month = parseYearMonth(raw);
  if (month === null) {
    throw new Error(`invalid year-month: ${raw}`);
  }
  return month;
}

export function shiftYearMonth(month: YearMonth, deltaMonths: number): YearMonth {
  const year = Number(month.slice(0, 4));
  const monthIndex = Number(month.slice(5, 7)) - 1;
  const absolute = year * 12 + monthIndex + deltaMonths;
  const nextYear = Math.floor(absolute / 12);
  const nextMonth = absolute - nextYear * 12 + 1;
  const raw = `${String(nextYear).padStart(4, "0")}-${String(nextMonth).padStart(2, "0")}`;
  return requireYearMonth(raw);
}

export function trailingYearMonths(anchor: YearMonth): MonthWindow {
  return [
    shiftYearMonth(anchor, -5),
    shiftYearMonth(anchor, -4),
    shiftYearMonth(anchor, -3),
    shiftYearMonth(anchor, -2),
    shiftYearMonth(anchor, -1),
    anchor,
  ];
}

// 月末は UTC の翌月1日の前日。ローカルタイムゾーンだとうるう日がずれる。
const DAY_MS = 24 * 60 * 60 * 1000;

export function monthDateRange(month: YearMonth): { from: string; to: string } {
  const year = Number(month.slice(0, 4));
  const monthIndex = Number(month.slice(5, 7));
  const from = `${month}-01`;
  const nextMonthStart = Date.UTC(year, monthIndex, 1);
  const lastDayOfMonth = new Date(nextMonthStart - DAY_MS);
  const to = lastDayOfMonth.toISOString().slice(0, 10);
  return { from, to };
}

export function monthHref(month: YearMonth): `/months/${string}` {
  return `/months/${month}`;
}

export function formatYearMonthLabel(month: YearMonth): string {
  const year = month.slice(0, 4);
  const mon = Number(month.slice(5, 7));
  return `${year}年${mon}月`;
}

function toShareItem(item: MonthItemFact): ExpenseItemInput {
  return {
    name: "",
    price: item.price,
    quantity: item.quantity,
    shares: item.shares.map((share) => ({
      memberId: share.memberId,
      ratioPercent: share.ratioPercent,
    })),
  };
}

function emptyCategoryAmounts(): CategoryAmounts {
  return {
    food: 0,
    daily: 0,
    transport: 0,
    housing: 0,
    medical: 0,
    leisure: 0,
    other: 0,
    uncategorized: 0,
  };
}

function zeroMember(memberId: string): FoldMember {
  return {
    memberId,
    paidAmount: 0,
    shareAmount: 0,
    unsettledPaidAmount: 0,
  };
}

function addConfirmed(
  member: FoldMember,
  fact: MonthExpenseFact,
  items: ExpenseItemInput[],
): void {
  if (fact.paidBy === member.memberId) {
    member.paidAmount += fact.totalAmount;
    if (!fact.settled) {
      member.unsettledPaidAmount += fact.totalAmount;
    }
  }
  for (const item of items) {
    member.shareAmount += calcItemShareAmount(item, member.memberId);
  }
}

export function foldMonth(
  month: YearMonth,
  facts: readonly MonthExpenseFact[],
  viewerId: string,
  partnerId: string | null,
): FoldedMonth {
  const categoryAmounts = emptyCategoryAmounts();
  let confirmedCount = 0;
  let draftCount = 0;
  let totalAmount = 0;
  let settledAmount = 0;
  let unsettledAmount = 0;
  const viewer = zeroMember(viewerId);
  const partner = partnerId === null ? null : zeroMember(partnerId);
  const unsettledExpenses: SettlementExpenseInput[] = [];

  for (const fact of facts) {
    if (fact.purchasedAt !== month) {
      throw new Error(
        `foldMonth: purchasedAt ${fact.purchasedAt} is not ${month}`,
      );
    }
    if (fact.status === "draft") {
      draftCount += 1;
      continue;
    }

    confirmedCount += 1;
    totalAmount += fact.totalAmount;
    categoryAmounts[fact.category] += fact.totalAmount;
    const items = fact.items.map(toShareItem);
    if (fact.settled) {
      settledAmount += fact.totalAmount;
    } else {
      unsettledAmount += fact.totalAmount;
      unsettledExpenses.push({ paidBy: fact.paidBy, items });
    }
    addConfirmed(viewer, fact, items);
    if (partner !== null) {
      addConfirmed(partner, fact, items);
    }
  }

  const unsettledBalance: SettlementBalance =
    partnerId === null
      ? { fromMemberId: null, toMemberId: null, amount: 0 }
      : calcNetBalance(viewerId, partnerId, unsettledExpenses);

  const folded = {
    month,
    confirmedCount,
    draftCount,
    totalAmount,
    settledAmount,
    unsettledAmount,
    unsettledBalance,
    categoryAmounts,
  };

  if (partner === null) {
    const members: readonly [FoldMember] = [viewer];
    return { ...folded, members };
  }
  const members: readonly [FoldMember, FoldMember] = [viewer, partner];
  return { ...folded, members };
}

export function visibleCategories(
  amounts: CategoryAmounts,
): readonly CategorySlice[] {
  const slices: CategorySlice[] = [];
  for (const category of CATEGORIES) {
    const amount = amounts[category.id];
    if (amount === 0) {
      continue;
    }
    slices.push({ id: category.id, label: category.label, amount });
  }
  if (amounts.uncategorized !== 0) {
    slices.push({
      id: "uncategorized",
      label: categoryLabel("uncategorized"),
      amount: amounts.uncategorized,
    });
  }
  return slices;
}

export function categoryRatio(amount: number, totalAmount: number): number {
  if (totalAmount === 0) {
    return 0;
  }
  return amount / totalAmount;
}

export function toMonthExpenseFact(doc: {
  purchasedAt: string;
  status: "draft" | "confirmed";
  settlementId?: string;
  paidBy: string;
  totalAmount: number;
  category?: string;
  items: ReadonlyArray<MonthItemFact>;
}): MonthExpenseFact {
  return {
    purchasedAt: requireYearMonth(doc.purchasedAt.slice(0, 7)),
    status: doc.status,
    settled: doc.settlementId !== undefined,
    paidBy: doc.paidBy,
    totalAmount: doc.totalAmount,
    category: normalizeCategory(doc.category),
    items: doc.items,
  };
}
