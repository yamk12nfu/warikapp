import { ConvexError, v } from "convex/values";
import { mutation, query, type MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireMember } from "./lib/auth";

// 差し戻し・取り消しは精算の行ごと消えるので、相手に見せる記録はここに残す。
// 確認依頼は pending の行そのものが依頼なので、お知らせの行は作らない
export type SettlementEvent = {
  kind: "settlementRejected" | "settlementCancelled";
  settlement: Doc<"settlements">;
  actor: Doc<"members">;
  recipientId: Id<"members">;
};

export const MAX_NOTICES = 5;

export async function emitSettlementEvent(
  ctx: MutationCtx,
  event: SettlementEvent,
): Promise<void> {
  const existing = await ctx.db
    .query("notices")
    .withIndex("by_recipientId", (q) =>
      q.eq("recipientId", event.recipientId),
    )
    .order("desc")
    .take(MAX_NOTICES + 1);
  for (const notice of existing.slice(MAX_NOTICES - 1)) {
    await ctx.db.delete("notices", notice._id);
  }

  await ctx.db.insert("notices", {
    coupleId: event.settlement.coupleId,
    recipientId: event.recipientId,
    actorId: event.actor._id,
    kind: event.kind,
    amount: event.settlement.amount,
    expenseCount: event.settlement.expenseCount,
  });
}

export type HomeNotice = {
  _id: Id<"notices">;
  kind: "settlementRejected" | "settlementCancelled";
  actorName: string;
  amount: number;
  expenseCount: number;
  createdAt: number;
};

export const mine = query({
  args: {},
  handler: async (ctx): Promise<HomeNotice[]> => {
    const member = await requireMember(ctx);
    const notices = await ctx.db
      .query("notices")
      .withIndex("by_recipientId", (q) =>
        q.eq("recipientId", member._id),
      )
      .order("desc")
      .take(MAX_NOTICES);
    const ownNotices = notices.filter(
      (notice) => notice.coupleId === member.coupleId,
    );

    return await Promise.all(
      ownNotices.map(async (notice) => {
        const actor = await ctx.db.get("members", notice.actorId);
        return {
          _id: notice._id,
          kind: notice.kind,
          actorName: actor?.displayName ?? "メンバー",
          amount: notice.amount,
          expenseCount: notice.expenseCount,
          createdAt: notice._creationTime,
        };
      }),
    );
  },
});

const ERR_NOTICE_NOT_FOUND = "お知らせが見つかりません";

export const dismiss = mutation({
  args: { noticeId: v.id("notices") },
  handler: async (ctx: MutationCtx, args): Promise<null> => {
    const member = await requireMember(ctx);
    const notice = await ctx.db.get("notices", args.noticeId);
    if (
      notice === null ||
      notice.coupleId !== member.coupleId ||
      notice.recipientId !== member._id
    ) {
      throw new ConvexError(ERR_NOTICE_NOT_FOUND);
    }
    await ctx.db.delete("notices", notice._id);
    return null;
  },
});
