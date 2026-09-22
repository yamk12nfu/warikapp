import { MutationCtx, QueryCtx } from "../_generated/server";
import { Doc, Id } from "../_generated/dataModel";

export const MAX_MEMBERS = 2;

type MemberCtx = QueryCtx | MutationCtx;

export async function listActiveMembers(
  ctx: MemberCtx,
  coupleId: Id<"couples">,
): Promise<Doc<"members">[]> {
  return await ctx.db
    .query("members")
    .withIndex("by_coupleId_and_leftAt", (q) =>
      q.eq("coupleId", coupleId).eq("leftAt", undefined),
    )
    .take(MAX_MEMBERS);
}

export async function listAllMembers(
  ctx: MemberCtx,
  coupleId: Id<"couples">,
): Promise<Doc<"members">[]> {
  return await ctx.db
    .query("members")
    .withIndex("by_coupleId", (q) => q.eq("coupleId", coupleId))
    .collect();
}

export async function departMember(
  ctx: MutationCtx,
  member: Doc<"members">,
): Promise<void> {
  if (member.leftAt !== undefined || member.tokenIdentifier === undefined) {
    return;
  }
  await ctx.db.patch("members", member._id, {
    tokenIdentifier: undefined,
    leftAt: Date.now(),
  });
}
