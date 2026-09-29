import { ConvexError, v } from "convex/values";
import { query, type QueryCtx } from "./_generated/server";
import { Doc } from "./_generated/dataModel";
import { requireMember } from "./lib/auth";
import { loadSettlementScope } from "./lib/settlementScope";
import { listActiveMembers, listAllMembers } from "./lib/members";
import { MAX_UNSETTLED_EXPENSES } from "./settlements";
import type { SettlementBalance } from "../lib/settlement";
import {
  foldMonth,
  categoryItemRows,
  MAX_MONTH_EXPENSES,
  monthDateRange,
  parseBookMonth,
  parseMonthCategory,
  toMonthExpenseFact,
  visibleCategories,
  type CategorySlice,
  type FoldedMonth,
  type YearMonth,
} from "../lib/month-book";

const ERR_MONTH = "月の指定が正しくありません";
const ERR_CATEGORY = "分類の指定が正しくありません";

type MonthExpenseRead =
  | { kind: "overflow"; limit: number }
  | { kind: "rows"; rows: Doc<"expenses">[] };

async function readMonthExpenses(
  ctx: QueryCtx,
  coupleId: Doc<"members">["coupleId"],
  monthValue: YearMonth,
): Promise<MonthExpenseRead> {
  const { from, to } = monthDateRange(monthValue);
  const rows = await ctx.db
    .query("expenses")
    .withIndex("by_coupleId_and_deletedAt_and_purchasedAt", (q) =>
      q
        .eq("coupleId", coupleId)
        .eq("deletedAt", undefined)
        .gte("purchasedAt", from)
        .lte("purchasedAt", to),
    )
    .order("desc")
    .take((MAX_UNSETTLED_EXPENSES satisfies typeof MAX_MONTH_EXPENSES) + 1);

  if (rows.length > MAX_UNSETTLED_EXPENSES) {
    return {
      kind: "overflow",
      limit: MAX_MONTH_EXPENSES satisfies typeof MAX_UNSETTLED_EXPENSES,
    };
  }
  return { kind: "rows", rows };
}

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
    const monthValue = parseBookMonth(args.month);
    if (monthValue === null) {
      throw new ConvexError(ERR_MONTH);
    }
    const [activeMembers, allMembers] = await Promise.all([
      listActiveMembers(ctx, member.coupleId),
      listAllMembers(ctx, member.coupleId),
    ]);
    const partner =
      activeMembers.find((row) => row._id !== member._id) ??
      allMembers.find((row) => row._id !== member._id) ??
      null;
    const [read, scope] = await Promise.all([
      readMonthExpenses(ctx, member.coupleId, monthValue),
      loadSettlementScope(ctx, member.coupleId),
    ]);
    if (read.kind === "overflow") {
      return {
        kind: "overflow" as const,
        month: monthValue,
        limit: read.limit,
      };
    }

    const folded = foldMonth(
      monthValue,
      read.rows.map((row) => toMonthExpenseFact(row, scope.pendingId)),
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

export const categoryItems = query({
  args: { month: v.string(), category: v.string() },
  handler: async (ctx, args) => {
    const member = await requireMember(ctx);
    const monthValue = parseBookMonth(args.month);
    if (monthValue === null) {
      throw new ConvexError(ERR_MONTH);
    }
    const category = parseMonthCategory(args.category);
    if (category === null) {
      throw new ConvexError(ERR_CATEGORY);
    }

    const [read, scope] = await Promise.all([
      readMonthExpenses(ctx, member.coupleId, monthValue),
      loadSettlementScope(ctx, member.coupleId),
    ]);
    if (read.kind === "overflow") {
      return { kind: "overflow" as const, limit: read.limit };
    }

    const rows = categoryItemRows(
      read.rows.map((row) => toMonthExpenseFact(row, scope.pendingId)),
      category,
    );
    return {
      kind: "rows" as const,
      rows,
      totalAmount: rows.reduce((sum, row) => sum + row.amount, 0),
    };
  },
});
