import { ConvexError, v } from "convex/values";
import { internalQuery, mutation, QueryCtx, MutationCtx } from "./_generated/server";
import { Id } from "./_generated/dataModel";
import { requireMember } from "./lib/auth";

// レシート画像のアップロード窓口(Phase 8 / F-003)。
//
// このファイルは query / mutation だけを置き、AI呼び出しの action は
// convex/receipts.ts に分けてある。Convexのガイドラインが
// 「"use node" のファイルに query / mutation を同居させない」ことを求めるため
// (Node.jsランタイムで動かせるのは action だけ)。計画書は両方を
// convex/receipts.ts に置く前提だったので、計画書側も分割に合わせて更新した。
//
// 画面に出すエラーは ConvexError で投げる(本番でも文言がクライアントに届く)。

const ERR_FOREIGN_STORAGE = "この画像は利用できません";

// storageId の世帯帰属を確認し、自世帯のものでなければ例外。
// expenses.save(imageStorageId)と receipts.parse の両方から使う。
export async function assertOwnedUpload(
  ctx: QueryCtx | MutationCtx,
  coupleId: Id<"couples">,
  storageId: Id<"_storage">,
) {
  const upload = await ctx.db
    .query("uploads")
    .withIndex("by_storageId", (q) => q.eq("storageId", storageId))
    .unique();
  if (upload === null || upload.coupleId !== coupleId) {
    // 未登録も他世帯も同じ文言にする(他世帯の画像の存在を漏らさない)
    throw new ConvexError(ERR_FOREIGN_STORAGE);
  }
}

// アップロード用URLの発行。クライアントはこのURLに画像をPOSTして storageId を得る。
// URLは発行したユーザーだけが受け取り、返る storageId も同じユーザーにしか渡らない
// (この前提の上で registerUpload の「先に登録した世帯のもの」判定が成り立つ)。
export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await requireMember(ctx);
    return await ctx.storage.generateUploadUrl();
  },
});

// アップロード直後に呼び、storageId を自世帯のものとして台帳に記録する。
// 同じ storageId の二重登録は、自世帯からなら何もしない(再試行で壊れないように)、
// 他世帯からなら拒否する。
export const registerUpload = mutation({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, args) => {
    const member = await requireMember(ctx);

    // 実体のないIDを台帳に登録させない(存在しないIDでの席取りを防ぐ)
    const metadata = await ctx.db.system.get("_storage", args.storageId);
    if (metadata === null) {
      throw new ConvexError(ERR_FOREIGN_STORAGE);
    }

    const existing = await ctx.db
      .query("uploads")
      .withIndex("by_storageId", (q) => q.eq("storageId", args.storageId))
      .unique();
    if (existing !== null) {
      if (existing.coupleId !== member.coupleId) {
        throw new ConvexError(ERR_FOREIGN_STORAGE);
      }
      return null;
    }

    await ctx.db.insert("uploads", {
      coupleId: member.coupleId,
      storageId: args.storageId,
      uploadedBy: member._id,
    });
    return null;
  },
});

// action(DBに触れない)から認証+storageIdの帰属をまとめて確認するための internal query。
// action → query の往復は少ないほどよいので、認可と帰属検証を1回にまとめてある。
export const authorizeUpload = internalQuery({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, args) => {
    const member = await requireMember(ctx);
    await assertOwnedUpload(ctx, member.coupleId, args.storageId);
    return { coupleId: member.coupleId };
  },
});
