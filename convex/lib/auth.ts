import { QueryCtx, MutationCtx } from "../_generated/server";

// ログイン済みであることを確認する(世帯未所属でも呼べる。setup画面用)
export async function requireUser(ctx: QueryCtx | MutationCtx) {
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
