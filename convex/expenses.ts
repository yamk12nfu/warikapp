import { ConvexError, v } from "convex/values";
import { mutation } from "./_generated/server";
import { Id } from "./_generated/dataModel";
import { assertCoupleMemberIds, requireMember } from "./lib/auth";
import { itemValidator } from "./schema";
import { calcTotalAmount } from "../lib/settlement";

// 支出の保存。クライアント由来の member ID(paidBy / shares[].memberId)は
// 必ず assertCoupleMemberIds を通してから保存する(他世帯IDの混入=テナント境界破りを防ぐ)。
// 画面に出すエラーは ConvexError で投げる(本番でもメッセージがクライアントに届く)。

const MAX_STORE_NAME_LENGTH = 50;
const MAX_ITEM_NAME_LENGTH = 50;
const MAX_PRICE = 9_999_999; // 要件 V-403
const MAX_QUANTITY = 999; // 総額が非現実的な桁にならないための上限
const MAX_ITEMS = 100; // レシート1枚の想定(数十品目)に対する安全弁
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

// 他世帯の支出を指定された場合も「存在しない」と同じ文言にする(存在を漏らさない)
const ERR_NOT_FOUND = "支出が見つかりません";
const ERR_SETTLED = "精算済みの支出は変更できません";
const ERR_ITEMS_REQUIRED = "品目を1件以上入力してください"; // V-402
const ERR_SHARE_TOTAL = "負担割合の合計が100%になるようにしてください"; // V-401
const ERR_PRICE = "金額は1円以上9,999,999円以下の整数で入力してください"; // V-403
const ERR_PURCHASED_AT = "購入日を正しく入力してください";

// JST(UTC+9)基準の今日。Convexの実行環境はUTCのため加算して求める。
// mutationでの Date.now() は許容される(queryでは結果が陳腐化するため禁止)。
function todayInJst(): string {
  return new Date(Date.now() + JST_OFFSET_MS).toISOString().slice(0, 10);
}

function normalizeStoreName(raw: string | undefined): string | undefined {
  const storeName = (raw ?? "").trim();
  if (storeName.length === 0) {
    return undefined; // 任意項目。patchに undefined を渡すとフィールドが消える
  }
  if (storeName.length > MAX_STORE_NAME_LENGTH) {
    throw new ConvexError("店名は50文字以内で入力してください");
  }
  return storeName;
}

function assertPurchasedAt(purchasedAt: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(purchasedAt)) {
    throw new ConvexError(ERR_PURCHASED_AT);
  }
  // 2026-02-31 のような実在しない日付を弾く(Dateは繰り上げてしまうため往復で確認)
  const parsed = new Date(`${purchasedAt}T00:00:00.000Z`);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== purchasedAt
  ) {
    throw new ConvexError(ERR_PURCHASED_AT);
  }
  // "YYYY-MM-DD" は辞書順=日付順なので文字列比較でよい
  if (purchasedAt > todayInJst()) {
    throw new ConvexError("購入日に未来の日付は指定できません");
  }
}

function assertShares(shares: { memberId: Id<"members">; ratioPercent: number }[]) {
  if (shares.length === 0) {
    throw new ConvexError(ERR_SHARE_TOTAL);
  }
  const seen = new Set<Id<"members">>();
  let total = 0;
  for (const share of shares) {
    if (seen.has(share.memberId)) {
      throw new ConvexError("同じメンバーの負担割合が重複しています");
    }
    seen.add(share.memberId);
    if (
      !Number.isInteger(share.ratioPercent) ||
      share.ratioPercent < 0 ||
      share.ratioPercent > 100
    ) {
      throw new ConvexError("負担割合は0〜100の整数で入力してください");
    }
    total += share.ratioPercent;
  }
  if (total !== 100) {
    throw new ConvexError(ERR_SHARE_TOTAL); // V-401
  }
}

type ItemInput = {
  name: string;
  price: number;
  quantity: number;
  shares: { memberId: Id<"members">; ratioPercent: number }[];
};

// 品目名の前後空白を落として検証済みの品目を返す
function normalizeItems(items: ItemInput[]): ItemInput[] {
  if (items.length === 0) {
    throw new ConvexError(ERR_ITEMS_REQUIRED); // V-402
  }
  if (items.length > MAX_ITEMS) {
    throw new ConvexError(`品目は${MAX_ITEMS}件までです`);
  }
  return items.map((item) => {
    const name = item.name.trim();
    if (name.length < 1 || name.length > MAX_ITEM_NAME_LENGTH) {
      throw new ConvexError("品目名は1〜50文字で入力してください");
    }
    if (!Number.isInteger(item.price) || item.price < 1 || item.price > MAX_PRICE) {
      throw new ConvexError(ERR_PRICE); // V-403
    }
    if (
      !Number.isInteger(item.quantity) ||
      item.quantity < 1 ||
      item.quantity > MAX_QUANTITY
    ) {
      throw new ConvexError("数量は1〜999の整数で入力してください");
    }
    assertShares(item.shares);
    return { ...item, name };
  });
}

// 支出の新規作成と更新を兼ねる。expenseId を渡すと更新。
// source は新規作成時のみ使う(既存支出の由来は変えない)。
export const save = mutation({
  args: {
    expenseId: v.optional(v.id("expenses")),
    paidBy: v.id("members"),
    storeName: v.optional(v.string()),
    purchasedAt: v.string(),
    items: v.array(itemValidator),
    source: v.optional(v.union(v.literal("receipt"), v.literal("manual"))),
    status: v.union(v.literal("draft"), v.literal("confirmed")),
  },
  handler: async (ctx, args) => {
    const member = await requireMember(ctx);

    // 更新対象の存在・世帯・精算状態を先に確認する
    const existing =
      args.expenseId === undefined
        ? null
        : await ctx.db.get("expenses", args.expenseId);
    if (args.expenseId !== undefined) {
      if (
        existing === null ||
        existing.coupleId !== member.coupleId ||
        existing.deletedAt !== undefined
      ) {
        throw new ConvexError(ERR_NOT_FOUND);
      }
      if (existing.settlementId !== undefined) {
        throw new ConvexError(ERR_SETTLED);
      }
    }

    const storeName = normalizeStoreName(args.storeName);
    assertPurchasedAt(args.purchasedAt);
    const items = normalizeItems(args.items);

    // paidBy と全 shares[].memberId が自世帯のメンバーであることを検証する
    await assertCoupleMemberIds(ctx, member.coupleId, [
      args.paidBy,
      ...items.flatMap((item) => item.shares.map((share) => share.memberId)),
    ]);

    const totalAmount = calcTotalAmount(items);

    if (existing === null) {
      return await ctx.db.insert("expenses", {
        coupleId: member.coupleId,
        paidBy: args.paidBy,
        storeName,
        purchasedAt: args.purchasedAt,
        totalAmount,
        items,
        source: args.source ?? "manual",
        status: args.status,
      });
    }

    await ctx.db.patch("expenses", existing._id, {
      paidBy: args.paidBy,
      storeName,
      purchasedAt: args.purchasedAt,
      totalAmount,
      items,
      status: args.status,
    });
    return existing._id;
  },
});
