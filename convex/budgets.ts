import { ConvexError, v } from "convex/values";
import type { StoredCategoryId } from "../lib/category";
import { resolveBudgets } from "../lib/budget";
import { parseBookMonth } from "../lib/month-book";
import { requireMember } from "./lib/auth";
import { mutation, query } from "./_generated/server";
import { storedCategoryValidator } from "./schema";

const ERR_MONTH = "月の指定が正しくありません";
const ERR_AMOUNT = "予算は0〜99,999,999円の整数で入力してください";
const ERR_DUPLICATE_CATEGORY = "同じ分類を複数回指定できません";
const MAX_BUDGET_AMOUNT = 99_999_999;
const amountOrNull = v.union(v.number(), v.null());

function validateBudgetAmount(amount: number | null): void {
  if (
    amount !== null &&
    (!Number.isInteger(amount) || amount < 0 || amount > MAX_BUDGET_AMOUNT)
  ) {
    throw new ConvexError(ERR_AMOUNT);
  }
}

export const forMonth = query({
  args: { month: v.string() },
  handler: async (ctx, args) => {
    const member = await requireMember(ctx);
    const month = parseBookMonth(args.month);
    if (month === null) {
      throw new ConvexError(ERR_MONTH);
    }

    const rows = await ctx.db
      .query("budgets")
      .withIndex("by_coupleId_and_month", (q) =>
        q.eq("coupleId", member.coupleId).lte("month", month),
      )
      .order("desc")
      .take(500);

    return resolveBudgets(rows, month);
  },
});

export const setForMonth = mutation({
  args: {
    month: v.string(),
    overall: amountOrNull,
    categories: v.array(
      v.object({ category: storedCategoryValidator, amount: amountOrNull }),
    ),
  },
  handler: async (ctx, args) => {
    const member = await requireMember(ctx);
    const month = parseBookMonth(args.month);
    if (month === null) {
      throw new ConvexError(ERR_MONTH);
    }

    validateBudgetAmount(args.overall);
    const seenCategories = new Set<StoredCategoryId>();
    for (const row of args.categories) {
      validateBudgetAmount(row.amount);
      if (seenCategories.has(row.category)) {
        throw new ConvexError(ERR_DUPLICATE_CATEGORY);
      }
      seenCategories.add(row.category);
    }

    const rows = await ctx.db
      .query("budgets")
      .withIndex("by_coupleId_and_month", (q) =>
        q.eq("coupleId", member.coupleId).lte("month", month),
      )
      .order("desc")
      .take(500);
    const resolved = resolveBudgets(rows, month);
    const updates: Array<{
      category?: StoredCategoryId;
      amount: number | null;
    }> = [
      { amount: args.overall },
      ...args.categories,
    ];

    for (const update of updates) {
      const current =
        update.category === undefined
          ? resolved.overall
          : (resolved.categories[update.category] ?? null);
      const next = update.amount !== null && update.amount > 0 ? update.amount : null;
      if (current === next) {
        continue;
      }

      const existing = rows.find(
        (row) =>
          row.month === month && row.category === update.category,
      );
      const amount = update.amount ?? 0;
      if (existing !== undefined) {
        await ctx.db.patch("budgets", existing._id, { amount });
      } else {
        await ctx.db.insert("budgets", {
          coupleId: member.coupleId,
          month,
          amount,
          ...(update.category === undefined
            ? {}
            : { category: update.category }),
        });
      }
    }

    return null;
  },
});
