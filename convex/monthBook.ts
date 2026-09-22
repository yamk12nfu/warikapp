import { ConvexError, v } from "convex/values";
import { query } from "./_generated/server";
import { Doc } from "./_generated/dataModel";
import { requireMember } from "./lib/auth";
import { findPartner, MAX_UNSETTLED_EXPENSES } from "./settlements";
import type { SettlementBalance } from "../lib/settlement";
import {
  foldMonth,
  MAX_MONTH_EXPENSES,
  monthDateRange,
  parseYearMonth,
  toMonthExpenseFact,
  visibleCategories,
  type CategorySlice,
  type FoldedMonth,
  type YearMonth,
} from "../lib/month-book";

const ERR_MONTH = "月の指定が正しくありません";

// monthDateRange は Date.UTC を使う。年 0〜99 は 1900〜1999 になる。
// http.ts の isValidYear と同じ 2000〜2100 だけを月として受ける。
const MIN_YEAR = 2000;
const MAX_YEAR = 2100;

export type SliceMember = {
  memberId: string;
  displayName: string;
  isViewer: boolean;
  paidAmount: number;
  shareAmount: number;
};

export type MonthSlice = {
  month: YearMonth;
  confirmedCount: number;
  draftCount: number;
  totalAmount: number;
  settledAmount: number;
  unsettledAmount: number;
  unsettledBalance: SettlementBalance;
  members: readonly [SliceMember] | readonly [SliceMember, SliceMember];
  categories: readonly CategorySlice[];
};

function namedMembers(
  folded: FoldedMonth,
  viewer: Doc<"members">,
  partner: Doc<"members"> | null,
): MonthSlice["members"] {
  const viewerFold = folded.members[0];
  const viewerSlice: SliceMember = {
    memberId: viewer._id,
    displayName: viewer.displayName,
    isViewer: true,
    paidAmount: viewerFold.paidAmount,
    shareAmount: viewerFold.shareAmount,
  };
  if (partner === null) {
    return [viewerSlice];
  }
  const partnerFold = folded.members[1];
  if (partnerFold === undefined) {
    throw new Error("foldMonth omitted the partner");
  }
  return [
    viewerSlice,
    {
      memberId: partner._id,
      displayName: partner.displayName,
      isViewer: false,
      paidAmount: partnerFold.paidAmount,
      shareAmount: partnerFold.shareAmount,
    },
  ];
}

export const month = query({
  args: { month: v.string() },
  handler: async (ctx, args) => {
    const member = await requireMember(ctx);
    const monthValue = parseYearMonth(args.month);
    const year = monthValue === null ? NaN : Number(monthValue.slice(0, 4));
    if (monthValue === null || year < MIN_YEAR || year > MAX_YEAR) {
      throw new ConvexError(ERR_MONTH);
    }
    const partner = await findPartner(ctx, member);
    const { from, to } = monthDateRange(monthValue);

    // take は精算と同じ上限。返す limit は月次の名前。片方だけ変えると satisfies が落ちる。
    const rows = await ctx.db
      .query("expenses")
      .withIndex("by_coupleId_and_deletedAt_and_purchasedAt", (q) =>
        q
          .eq("coupleId", member.coupleId)
          .eq("deletedAt", undefined)
          .gte("purchasedAt", from)
          .lte("purchasedAt", to),
      )
      .take((MAX_UNSETTLED_EXPENSES satisfies typeof MAX_MONTH_EXPENSES) + 1);

    if (rows.length > MAX_UNSETTLED_EXPENSES) {
      return {
        kind: "overflow" as const,
        month: monthValue,
        limit: MAX_MONTH_EXPENSES satisfies typeof MAX_UNSETTLED_EXPENSES,
      };
    }

    const folded = foldMonth(
      monthValue,
      rows.map((row) => toMonthExpenseFact(row)),
      member._id,
      partner?._id ?? null,
    );
    return {
      kind: "exact" as const,
      slice: {
        month: folded.month,
        confirmedCount: folded.confirmedCount,
        draftCount: folded.draftCount,
        totalAmount: folded.totalAmount,
        settledAmount: folded.settledAmount,
        unsettledAmount: folded.unsettledAmount,
        unsettledBalance: folded.unsettledBalance,
        members: namedMembers(folded, member, partner),
        categories: visibleCategories(folded.categoryAmounts),
      },
    };
  },
});
