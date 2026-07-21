import { query } from "./_generated/server";

// ログイン中ユーザーの member レコードを返すルーティング用プローブ。
// 未ログイン・世帯未所属なら null(画面側で /setup へ振り分けるための状態値であり、
// 認可ゲートではない。世帯データに触る関数は requireMember の throw を使うこと)。
export const currentMember = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (identity === null) {
      return null;
    }
    const member = await ctx.db
      .query("members")
      .withIndex("by_tokenIdentifier", (q) =>
        q.eq("tokenIdentifier", identity.tokenIdentifier),
      )
      .unique();
    return member;
  },
});
