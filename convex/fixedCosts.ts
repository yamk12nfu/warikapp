import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalMutation,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { monthInJst, nextMonth, postedExpenseFields } from "../lib/fixed-cost";
import type { YearMonth } from "../lib/month-book";
import { assertCoupleMemberIds, requireMember } from "./lib/auth";
import { normalizeItems } from "./expenses";
import { shareValidator, storedCategoryValidator } from "./schema";
import { loadSettlementScope } from "./lib/settlementScope";

const ERR_NOT_FOUND = "固定費が見つかりません";
const ERR_NAME = "名目は1〜50文字で入力してください"; // V-1101
const ERR_STOPPED = "停止した固定費は変更できません"; // V-1103
const ERR_RESUME_MEMBER_LEFT = "パートナーが退出しているため再開できません";

type FixedCostTemplate = Pick<
  Doc<"fixedCosts">,
  | "_id"
  | "coupleId"
  | "name"
  | "amount"
  | "paidBy"
  | "shares"
  | "category"
  | "startMonth"
  | "stoppedAt"
>;

type MonthStatus = "posted" | "deleted" | "notPosted" | "notStarted";

type PostedExpense = Doc<"expenses"> & {
  fixedCost: NonNullable<Doc<"expenses">["fixedCost"]>;
};

function isPostedExpense(expense: Doc<"expenses">): expense is PostedExpense {
  return expense.fixedCost !== undefined;
}

// 論理削除済みの行も返す。削除した月を再計上しないための「計上済みの印」に使う
async function findPosting(
  ctx: QueryCtx,
  fixedCostId: Id<"fixedCosts">,
  month: string,
): Promise<PostedExpense | null> {
  const expense = await ctx.db
    .query("expenses")
    .withIndex("by_fixedCost_id_and_fixedCost_month", (q) =>
      q.eq("fixedCost.id", fixedCostId).eq("fixedCost.month", month),
    )
    .unique();
  return expense !== null && isPostedExpense(expense) ? expense : null;
}

async function findLeftMember(
  ctx: QueryCtx | MutationCtx,
  template: FixedCostTemplate,
): Promise<Id<"members"> | null> {
  const memberIds = new Set([
    template.paidBy,
    ...template.shares.map((share) => share.memberId),
  ]);
  for (const memberId of memberIds) {
    const member = await ctx.db.get("members", memberId);
    if (
      member === null ||
      member.coupleId !== template.coupleId ||
      member.leftAt !== undefined
    ) {
      return memberId;
    }
  }
  return null;
}

async function requireOwnedFixedCost(
  ctx: MutationCtx,
  coupleId: Id<"couples">,
  rawId: string,
): Promise<Doc<"fixedCosts">> {
  const fixedCostId = ctx.db.normalizeId("fixedCosts", rawId);
  const fixedCost =
    fixedCostId === null ? null : await ctx.db.get("fixedCosts", fixedCostId);
  if (fixedCost === null || fixedCost.coupleId !== coupleId) {
    throw new ConvexError(ERR_NOT_FOUND);
  }
  return fixedCost;
}

async function postMonth(
  ctx: MutationCtx,
  template: FixedCostTemplate,
  month: YearMonth,
): Promise<"posted" | "exists" | "notStarted" | "stopped" | "memberLeft"> {
  if (template.stoppedAt !== undefined) {
    return "stopped";
  }
  if (month < template.startMonth) {
    return "notStarted";
  }

  if ((await findPosting(ctx, template._id, month)) !== null) {
    return "exists";
  }

  if ((await findLeftMember(ctx, template)) !== null) {
    await ctx.db.patch("fixedCosts", template._id, {
      stoppedAt: Date.now(),
      stoppedReason: "memberLeft",
    });
    return "memberLeft";
  }

  await ctx.db.insert("expenses", {
    coupleId: template.coupleId,
    ...postedExpenseFields(template, month),
  });
  return "posted";
}

async function monthStatus(
  ctx: QueryCtx,
  template: Doc<"fixedCosts">,
  month: string,
): Promise<MonthStatus> {
  const expense = await findPosting(ctx, template._id, month);
  if (expense !== null) {
    return expense.deletedAt === undefined ? "posted" : "deleted";
  }
  return month < template.startMonth ? "notStarted" : "notPosted";
}

export const list = query({
  args: { month: v.string() },
  handler: async (ctx, args) => {
    const member = await requireMember(ctx);
    const [active, stopped] = await Promise.all([
      ctx.db
        .query("fixedCosts")
        .withIndex("by_coupleId_and_stoppedAt", (q) =>
          q.eq("coupleId", member.coupleId).eq("stoppedAt", undefined),
        )
        .take(50),
      ctx.db
        .query("fixedCosts")
        .withIndex("by_coupleId_and_stoppedAt", (q) =>
          q.eq("coupleId", member.coupleId).gt("stoppedAt", 0),
        )
        .take(50),
    ]);
    const [activeRows, stoppedRows] = await Promise.all([
      Promise.all(
        active.map(async (template) => ({
          ...template,
          thisMonth: await monthStatus(ctx, template, args.month),
        })),
      ),
      Promise.all(
        stopped.map(async (template) => ({
          ...template,
          thisMonth: await monthStatus(ctx, template, args.month),
        })),
      ),
    ]);
    return { active: activeRows, stopped: stoppedRows };
  },
});

export const get = query({
  args: { fixedCostId: v.string() },
  handler: async (ctx, args) => {
    const member = await requireMember(ctx);
    const fixedCostId = ctx.db.normalizeId("fixedCosts", args.fixedCostId);
    if (fixedCostId === null) {
      return null;
    }
    const fixedCost = await ctx.db.get("fixedCosts", fixedCostId);
    if (fixedCost === null || fixedCost.coupleId !== member.coupleId) {
      return null;
    }
    const [history, scope] = await Promise.all([
      ctx.db
        .query("expenses")
        .withIndex("by_fixedCost_id_and_fixedCost_month", (q) =>
          q.eq("fixedCost.id", fixedCost._id),
        )
        .order("desc")
        .take(12),
      loadSettlementScope(ctx, member.coupleId),
    ]);
    return {
      ...fixedCost,
      history: history.filter(isPostedExpense).map((expense) => ({
        month: expense.fixedCost.month,
        expenseId: expense._id,
        totalAmount: expense.totalAmount,
        deleted: expense.deletedAt !== undefined,
        settled: scope.stateOf(expense) !== "unsettled",
        settlementState: scope.stateOf(expense),
      })),
    };
  },
});

export const save = mutation({
  args: {
    fixedCostId: v.optional(v.string()),
    name: v.string(),
    amount: v.number(),
    paidBy: v.id("members"),
    shares: v.array(shareValidator),
    category: v.union(storedCategoryValidator, v.null()),
    startMonth: v.optional(v.union(v.literal("this"), v.literal("next"))), // V-1102
  },
  handler: async (ctx, args) => {
    const member = await requireMember(ctx);
    let existing: Doc<"fixedCosts"> | null = null;
    if (args.fixedCostId !== undefined) {
      existing = await requireOwnedFixedCost(
        ctx,
        member.coupleId,
        args.fixedCostId,
      );
      if (existing.stoppedAt !== undefined) {
        throw new ConvexError(ERR_STOPPED);
      }
    }

    const name = args.name.trim();
    if (name.length < 1 || name.length > 50) {
      throw new ConvexError(ERR_NAME);
    }
    const items = normalizeItems([
      { name, price: args.amount, quantity: 1, shares: args.shares },
    ]);
    const item = items[0];
    if (item === undefined) {
      throw new ConvexError(ERR_NAME);
    }
    await assertCoupleMemberIds(ctx, member.coupleId, [
      args.paidBy,
      ...item.shares.map((share) => share.memberId),
    ]);

    const category = args.category === null ? undefined : args.category;
    const currentMonth = monthInJst(Date.now());
    let template: FixedCostTemplate;
    let fixedCostId: Id<"fixedCosts">;
    if (existing === null) {
      const startMonth =
        args.startMonth === "next"
          ? nextMonth(currentMonth)
          : currentMonth;
      fixedCostId = await ctx.db.insert("fixedCosts", {
        coupleId: member.coupleId,
        name: item.name,
        amount: item.price,
        paidBy: args.paidBy,
        shares: item.shares,
        ...(category === undefined ? {} : { category }),
        startMonth,
      });
      template = {
        _id: fixedCostId,
        coupleId: member.coupleId,
        name: item.name,
        amount: item.price,
        paidBy: args.paidBy,
        shares: item.shares,
        ...(category === undefined ? {} : { category }),
        startMonth,
      };
    } else {
      fixedCostId = existing._id;
      await ctx.db.patch("fixedCosts", fixedCostId, {
        name: item.name,
        amount: item.price,
        paidBy: args.paidBy,
        shares: item.shares,
        category,
      });
      template = {
        ...existing,
        name: item.name,
        amount: item.price,
        paidBy: args.paidBy,
        shares: item.shares,
        category,
      };
    }

    await postMonth(ctx, template, currentMonth);
    return fixedCostId;
  },
});

export const stop = mutation({
  args: { fixedCostId: v.string() },
  handler: async (ctx, args) => {
    const member = await requireMember(ctx);
    const fixedCost = await requireOwnedFixedCost(
      ctx,
      member.coupleId,
      args.fixedCostId,
    );
    if (fixedCost.stoppedAt === undefined) {
      await ctx.db.patch("fixedCosts", fixedCost._id, {
        stoppedAt: Date.now(),
        stoppedReason: "user",
      });
    }
    return null;
  },
});

export const resume = mutation({
  args: { fixedCostId: v.string() },
  returns: v.union(
    v.literal("active"),
    v.literal("posted"),
    v.literal("exists"),
    v.literal("notStarted"),
    v.literal("stopped"),
    v.literal("memberLeft"),
  ),
  handler: async (ctx, args) => {
    const member = await requireMember(ctx);
    const fixedCost = await requireOwnedFixedCost(
      ctx,
      member.coupleId,
      args.fixedCostId,
    );
    if (fixedCost.stoppedAt === undefined) {
      return "active";
    }
    if ((await findLeftMember(ctx, fixedCost)) !== null) {
      throw new ConvexError(ERR_RESUME_MEMBER_LEFT);
    }

    await ctx.db.patch("fixedCosts", fixedCost._id, {
      stoppedAt: undefined,
      stoppedReason: undefined,
    });
    return await postMonth(
      ctx,
      { ...fixedCost, stoppedAt: undefined },
      monthInJst(Date.now()),
    );
  },
});

export const postThisMonth = mutation({
  args: { fixedCostId: v.string() },
  returns: v.union(
    v.literal("posted"),
    v.literal("exists"),
    v.literal("notStarted"),
    v.literal("stopped"),
    v.literal("memberLeft"),
  ),
  handler: async (ctx, args) => {
    const member = await requireMember(ctx);
    const fixedCost = await requireOwnedFixedCost(
      ctx,
      member.coupleId,
      args.fixedCostId,
    );
    return await postMonth(ctx, fixedCost, monthInJst(Date.now()));
  },
});

export const postCurrentMonth = internalMutation({
  args: { cursor: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const month = monthInJst(Date.now());
    const page = await ctx.db
      .query("fixedCosts")
      .withIndex("by_stoppedAt", (q) => q.eq("stoppedAt", undefined))
      .order("asc")
      .paginate({ numItems: 25, cursor: args.cursor ?? null });
    for (const template of page.page) {
      await postMonth(ctx, template, month);
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(
        0,
        internal.fixedCosts.postCurrentMonth,
        { cursor: page.continueCursor },
      );
    }
    return null;
  },
});
