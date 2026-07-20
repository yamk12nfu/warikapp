import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// 負担割合: 2名で合計100%になること(検証はアプリ層で行う)
const shareValidator = v.object({
  memberId: v.id("members"),
  ratioPercent: v.number(), // 0〜100の整数
});

// 品目。常に支出単位で読み書きするため expenses ドキュメントに内包する。
// レシート1枚ぶん(高々数十件)の有界な配列なので1MB上限に対して十分小さい。
const itemValidator = v.object({
  name: v.string(), // 1〜50文字
  price: v.number(), // 税込・円・整数(1〜9,999,999)
  quantity: v.number(), // 1以上の整数
  shares: v.array(shareValidator),
});

export default defineSchema({
  couples: defineTable({
    name: v.string(), // 省略時「わたしたち」
  }),

  members: defineTable({
    coupleId: v.id("couples"),
    // 認証プロバイダ発行の安定ID(identity.tokenIdentifier)
    tokenIdentifier: v.string(),
    displayName: v.string(), // 1〜20文字
  })
    .index("by_tokenIdentifier", ["tokenIdentifier"])
    .index("by_coupleId", ["coupleId"]),

  invitations: defineTable({
    coupleId: v.id("couples"),
    code: v.string(), // 8文字英数字
    expiresAt: v.number(), // 発行から72時間(エポックms)
    usedAt: v.optional(v.number()),
  }).index("by_code", ["code"]),

  expenses: defineTable({
    coupleId: v.id("couples"),
    paidBy: v.id("members"),
    storeName: v.optional(v.string()),
    purchasedAt: v.string(), // "YYYY-MM-DD"
    totalAmount: v.number(), // 品目合計から算出して保存
    items: v.array(itemValidator), // 1件以上
    imageStorageId: v.optional(v.id("_storage")), // レシート画像。手入力は未設定
    source: v.union(v.literal("receipt"), v.literal("manual")),
    status: v.union(v.literal("draft"), v.literal("confirmed")),
    settlementId: v.optional(v.id("settlements")), // 未設定なら未精算
    deletedAt: v.optional(v.number()), // 論理削除
  }).index("by_coupleId_and_purchasedAt", ["coupleId", "purchasedAt"]),

  settlements: defineTable({
    coupleId: v.id("couples"),
    fromMemberId: v.id("members"), // 支払う側
    toMemberId: v.id("members"), // 受け取る側
    amount: v.number(),
    memo: v.optional(v.string()), // 100文字以内
    settledBy: v.id("members"),
  }).index("by_coupleId", ["coupleId"]),

  // AI読み取りのレート制限用(要件: 30回/時/世帯)。時刻は _creationTime を使う
  parseLogs: defineTable({
    coupleId: v.id("couples"),
  }).index("by_coupleId", ["coupleId"]),
});
