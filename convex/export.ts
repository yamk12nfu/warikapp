import { paginationOptsValidator } from "convex/server";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { action, internalQuery } from "./_generated/server";
import { expenseRows, settlementRows, toCsv } from "../lib/csv";
import { listAllMembers } from "./lib/members";

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const PAGE_SIZE = 200;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

type PageResult<T> = {
  page: T[];
  isDone: boolean;
  continueCursor: string;
};

function dateAtJstMidnightUtc(date: string): number {
  if (!DATE_PATTERN.test(date)) {
    throw new ConvexError("期間の日付を正しく入力してください");
  }
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== date
  ) {
    throw new ConvexError("期間の日付を正しく入力してください");
  }
  return parsed.getTime() - JST_OFFSET_MS;
}

export const pageExpenses = internalQuery({
  args: {
    coupleId: v.id("couples"),
    from: v.string(),
    to: v.string(),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("expenses")
      .withIndex("by_coupleId_and_deletedAt_and_purchasedAt", (q) =>
        q
          .eq("coupleId", args.coupleId)
          .eq("deletedAt", undefined)
          .gte("purchasedAt", args.from)
          .lte("purchasedAt", args.to),
      )
      .paginate(args.paginationOpts);
  },
});

export const pageSettlements = internalQuery({
  args: {
    coupleId: v.id("couples"),
    fromMs: v.number(),
    toMs: v.number(),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("settlements")
      .withIndex("by_coupleId", (q) =>
        q
          .eq("coupleId", args.coupleId)
          .gte("_creationTime", args.fromMs)
          .lt("_creationTime", args.toMs),
      )
      .paginate(args.paginationOpts);
  },
});

export const listExportMembers = internalQuery({
  args: { coupleId: v.id("couples") },
  handler: async (ctx, args) => await listAllMembers(ctx, args.coupleId),
});

export const csv = action({
  args: {
    kind: v.union(v.literal("expenses"), v.literal("settlements")),
    from: v.string(),
    to: v.string(),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ filename: string; csv: string }> => {
    const member: Doc<"members"> = await ctx.runQuery(
      internal.lib.auth.getCurrentMember,
      {},
    );
    const fromMs = dateAtJstMidnightUtc(args.from);
    const toStartMs = dateAtJstMidnightUtc(args.to);
    if (args.from > args.to) {
      throw new ConvexError("開始日は終了日以前の日付を指定してください");
    }

    const members: Doc<"members">[] = await ctx.runQuery(
      internal.export.listExportMembers,
      { coupleId: member.coupleId },
    );
    const memberNames = new Map<string, string>(
      members.map((row) => [row._id, row.displayName] as const),
    );

    if (args.kind === "expenses") {
      const expenses: Doc<"expenses">[] = [];
      let cursor: string | null = null;
      let isDone = false;
      while (!isDone) {
        const page: PageResult<Doc<"expenses">> = await ctx.runQuery(
          internal.export.pageExpenses,
          {
            coupleId: member.coupleId,
            from: args.from,
            to: args.to,
            paginationOpts: { numItems: PAGE_SIZE, cursor },
          },
        );
        expenses.push(...page.page);
        cursor = page.continueCursor;
        isDone = page.isDone;
      }
      return {
        filename: `warikapp-支出-${args.from}_${args.to}.csv`,
        csv: toCsv(expenseRows(expenses, memberNames)),
      };
    }

    const settlements: Doc<"settlements">[] = [];
    let cursor: string | null = null;
    let isDone = false;
    while (!isDone) {
      const page: PageResult<Doc<"settlements">> = await ctx.runQuery(
        internal.export.pageSettlements,
        {
          coupleId: member.coupleId,
          fromMs,
          toMs: toStartMs + DAY_MS,
          paginationOpts: { numItems: PAGE_SIZE, cursor },
        },
      );
      settlements.push(...page.page);
      cursor = page.continueCursor;
      isDone = page.isDone;
    }
    return {
      filename: `warikapp-精算-${args.from}_${args.to}.csv`,
      csv: toCsv(settlementRows(settlements, memberNames)),
    };
  },
});
