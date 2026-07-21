import { query } from "./_generated/server";

// ログイン中ユーザーの世帯所属を返すルーティング用プローブ。
// 未ログイン・世帯未所属なら null(画面側で /setup へ振り分けるための状態値であり、
// 認可ゲートではない。世帯データに触る関数は requireMember の throw を使うこと)。
// 情報最小化のため、画面に必要なフィールドだけを射影して返す。
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
    if (member === null) {
      return null;
    }
    return {
      _id: member._id,
      coupleId: member.coupleId,
      displayName: member.displayName,
    };
  },
});
