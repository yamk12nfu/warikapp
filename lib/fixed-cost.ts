import type { StoredCategoryId } from "./category";
import {
  requireYearMonth,
  shiftYearMonth,
  type YearMonth,
} from "./month-book";

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

export function monthInJst(nowMs: number): YearMonth {
  return requireYearMonth(
    new Date(nowMs + JST_OFFSET_MS).toISOString().slice(0, 7),
  );
}

export function nextMonth(month: YearMonth): YearMonth {
  return shiftYearMonth(month, 1);
}

export function firstDayOf(month: YearMonth): string {
  return `${month}-01`;
}

export function postedExpenseFields<
  TId extends string,
  TMemberId extends string,
>(
  template: {
    _id: TId;
    name: string;
    amount: number;
    paidBy: TMemberId;
    shares: Array<{ memberId: TMemberId; ratioPercent: number }>;
    category?: StoredCategoryId;
  },
  month: YearMonth,
): {
  paidBy: TMemberId;
  purchasedAt: string;
  totalAmount: number;
  items: Array<{
    name: string;
    price: number;
    quantity: number;
    shares: Array<{ memberId: TMemberId; ratioPercent: number }>;
  }>;
  category?: StoredCategoryId;
  source: "manual";
  status: "confirmed";
  fixedCost: { id: TId; month: YearMonth };
} {
  return {
    paidBy: template.paidBy,
    purchasedAt: firstDayOf(month),
    totalAmount: template.amount,
    items: [
      {
        name: template.name,
        price: template.amount,
        quantity: 1,
        shares: template.shares,
      },
    ],
    ...(template.category === undefined ? {} : { category: template.category }),
    source: "manual",
    status: "confirmed",
    fixedCost: { id: template._id, month },
  };
}
