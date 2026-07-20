import { Auth } from "convex/server";
import {
  internalQuery,
  QueryCtx,
  MutationCtx,
} from "../_generated/server";
import { Id } from "../_generated/dataModel";

// ログイン済みであることを確認する(世帯未所属でも呼べる。setup画面用)。
// ctx は auth を持てばよいので query / mutation / action のどれからでも呼べる。
export async function requireUser(ctx: { auth: Auth }) {
  const identity = await ctx.auth.getUserIdentity();
  if (identity === null) {
    throw new Error("ログインしてください");
  }
  return identity;
}

// ログイン済み+世帯所属を確認し、自分の member レコードを返す。
// 公開 query / mutation で世帯データに触る前に必ず呼ぶこと(セキュリティの要)。
// 取得したドキュメントには coupleId の一致チェックも忘れずに行う。
export async function requireMember(ctx: QueryCtx | MutationCtx) {
  const identity = await requireUser(ctx);
  const member = await ctx.db
    .query("members")
    .withIndex("by_tokenIdentifier", (q) =>
      q.eq("tokenIdentifier", identity.tokenIdentifier),
    )
    .unique();
  if (member === null) {
    throw new Error("世帯に参加してください");
  }
  return member;
}

// 受け取ったメンバーIDがすべて指定世帯のメンバーであることを検証する。
// paidBy や shares[].memberId など、クライアント由来の member ID は
// 保存前に必ずこれを通すこと(他世帯IDの混入=テナント境界破りを防ぐ)。
export async function assertCoupleMemberIds(
  ctx: QueryCtx | MutationCtx,
  coupleId: Id<"couples">,
  memberIds: Id<"members">[],
) {
  for (const memberId of new Set(memberIds)) {
    const member = await ctx.db.get("members", memberId);
    if (member === null || member.coupleId !== coupleId) {
      throw new Error("権限がありません");
    }
  }
}

// action(DBに直接触れない)から認証+所属確認するための internal query。
// 使い方: const member = await ctx.runQuery(internal.lib.auth.getCurrentMember, {});
export const getCurrentMember = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await requireMember(ctx);
  },
});
