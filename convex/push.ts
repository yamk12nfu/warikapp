import { internal } from "./_generated/api";
import { Doc, Id } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  env,
  mutation,
  query,
} from "./_generated/server";
import { ConvexError, v } from "convex/values";
import { requireMember } from "./lib/auth";
import { listActiveMembers } from "./lib/members";
import { isAllowedPushEndpoint } from "../lib/push";

const ERR_BAD_ENDPOINT = "この通知先は登録できません";

const SUBSCRIPTION_DELETE_BATCH_SIZE = 100;

export const vapidPublicKey = query({
  args: {},
  handler: async (ctx) => {
    await requireMember(ctx);
    return env.VAPID_PUBLIC_KEY ?? null;
  },
});

export const subscribe = mutation({
  args: {
    endpoint: v.string(),
    keys: v.object({ p256dh: v.string(), auth: v.string() }),
  },
  handler: async (ctx, args) => {
    const member = await requireMember(ctx);
    if (!isAllowedPushEndpoint(args.endpoint)) {
      throw new ConvexError(ERR_BAD_ENDPOINT);
    }
    const existing = await ctx.db
      .query("pushSubscriptions")
      .withIndex("by_endpoint", (q) => q.eq("endpoint", args.endpoint))
      .unique();

    if (existing !== null) {
      if (
        existing.coupleId !== member.coupleId ||
        existing.memberId !== member._id
      ) {
        throw new ConvexError("権限がありません");
      }
      await ctx.db.patch("pushSubscriptions", existing._id, {
        memberId: member._id,
        coupleId: member.coupleId,
        keys: args.keys,
      });
      return null;
    }

    await ctx.db.insert("pushSubscriptions", {
      coupleId: member.coupleId,
      memberId: member._id,
      endpoint: args.endpoint,
      keys: args.keys,
    });
    return null;
  },
});

export const unsubscribe = mutation({
  args: { endpoint: v.string() },
  handler: async (ctx, args) => {
    const member = await requireMember(ctx);
    const subscription = await ctx.db
      .query("pushSubscriptions")
      .withIndex("by_endpoint", (q) => q.eq("endpoint", args.endpoint))
      .unique();
    if (
      subscription !== null &&
      subscription.memberId === member._id &&
      subscription.coupleId === member.coupleId
    ) {
      await ctx.db.delete("pushSubscriptions", subscription._id);
    }
    return null;
  },
});

export const isSubscribed = query({
  args: { endpoint: v.string() },
  handler: async (ctx, args) => {
    const member = await requireMember(ctx);
    const subscription = await ctx.db
      .query("pushSubscriptions")
      .withIndex("by_endpoint", (q) => q.eq("endpoint", args.endpoint))
      .unique();
    return (
      subscription !== null &&
      subscription.memberId === member._id &&
      subscription.coupleId === member.coupleId
    );
  },
});

export const listForMember = internalQuery({
  args: { memberId: v.id("members") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("pushSubscriptions")
      .withIndex("by_memberId", (q) => q.eq("memberId", args.memberId))
      .collect();
  },
});

export const removeByEndpoint = internalMutation({
  args: { endpoint: v.string(), memberId: v.id("members") },
  handler: async (ctx, args) => {
    const subscription = await ctx.db
      .query("pushSubscriptions")
      .withIndex("by_endpoint", (q) => q.eq("endpoint", args.endpoint))
      .unique();
    if (subscription?.memberId === args.memberId) {
      await ctx.db.delete("pushSubscriptions", subscription._id);
    }
    return null;
  },
});

export const removeForMember = internalMutation({
  args: { memberId: v.id("members") },
  handler: async (ctx, args) => {
    const subscriptions = await ctx.db
      .query("pushSubscriptions")
      .withIndex("by_memberId", (q) => q.eq("memberId", args.memberId))
      .take(SUBSCRIPTION_DELETE_BATCH_SIZE);
    for (const subscription of subscriptions) {
      await ctx.db.delete("pushSubscriptions", subscription._id);
    }
    if (subscriptions.length === SUBSCRIPTION_DELETE_BATCH_SIZE) {
      await ctx.scheduler.runAfter(0, internal.push.removeForMember, args);
    }
    return null;
  },
});

export const settlementRequestDetails = internalQuery({
  args: { settlementId: v.id("settlements") },
  handler: async (ctx, args): Promise<{
    memberId: Id<"members">;
    actorName: string;
    amount: number;
    expenseCount: number;
  } | null> => {
    const settlement = await ctx.db.get("settlements", args.settlementId);
    if (settlement === null || settlement.status !== "pending") {
      return null;
    }

    const starter = await ctx.db.get("members", settlement.settledBy);
    if (
      starter === null ||
      starter.coupleId !== settlement.coupleId ||
      starter.leftAt !== undefined
    ) {
      return null;
    }
    const recipient = (await listActiveMembers(ctx, settlement.coupleId)).find(
      (member: Doc<"members">) => member._id !== settlement.settledBy,
    );
    if (recipient === undefined) {
      return null;
    }

    return {
      memberId: recipient._id,
      actorName: starter.displayName,
      amount: settlement.amount,
      expenseCount: settlement.expenseCount,
    };
  },
});
