import { paginationOptsValidator } from "convex/server";
import { ConvexError, v } from "convex/values";
import { mutation, query, QueryCtx, MutationCtx } from "./_generated/server";
import { Doc, Id } from "./_generated/dataModel";
import { assertCoupleMemberIds, requireMember } from "./lib/auth";
import { markUploadUsed } from "./uploads";
import { itemValidator } from "./schema";
import { calcTotalAmount } from "../lib/settlement";
import { todayInJst } from "../lib/date";

// 支出の保存。クライアント由来の member ID(paidBy / shares[].memberId)は
// 必ず assertCoupleMemberIds を通してから保存する(他世帯IDの混入=テナント境界破りを防ぐ)。
// 画面に出すエラーは ConvexError で投げる(本番でもメッセージがクライアントに届く)。

const MAX_STORE_NAME_LENGTH = 50;
const MAX_ITEM_NAME_LENGTH = 50;
const MAX_PRICE = 9_999_999; // 要件 V-403
const MAX_QUANTITY = 999; // 総額が非現実的な桁にならないための上限
const MAX_ITEMS = 100; // レシート1枚の想定(数十品目)に対する安全弁

// 他世帯の支出を指定された場合も「存在しない」と同じ文言にする(存在を漏らさない)
const ERR_NOT_FOUND = "支出が見つかりません";
const ERR_SETTLED = "精算済みの支出は変更できません";
const ERR_ITEMS_REQUIRED = "品目を1件以上入力してください"; // V-402
const ERR_SHARE_TOTAL = "負担割合の合計が100%になるようにしてください"; // V-401
const ERR_PRICE = "金額は1円以上9,999,999円以下の整数で入力してください"; // V-403
const ERR_PURCHASED_AT = "購入日を正しく入力してください";

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

// 自世帯の生きている支出を引く。存在しない・他世帯・論理削除済みはすべて null を
// 返す(他世帯の支出の存在を漏らさないため、呼び出し側でも区別しないこと)。
async function findOwnExpense(
  ctx: QueryCtx | MutationCtx,
  coupleId: Id<"couples">,
  expenseId: Id<"expenses">,
): Promise<Doc<"expenses"> | null> {
  const expense = await ctx.db.get("expenses", expenseId);
  if (
    expense === null ||
    expense.coupleId !== coupleId ||
    expense.deletedAt !== undefined
  ) {
    return null;
  }
  return expense;
}

// 支出の新規作成と更新を兼ねる。expenseId を渡すと更新。
// source は新規作成時のみ使う(既存支出の由来は変えない)。
// imageStorageId は省略時「変更しない」。編集画面は画像を扱わないため、
// undefined を「画像を消す」と解釈するとレシートの画像が編集のたびに消えてしまう。
export const save = mutation({
  args: {
    expenseId: v.optional(v.id("expenses")),
    paidBy: v.id("members"),
    storeName: v.optional(v.string()),
    purchasedAt: v.string(),
    items: v.array(itemValidator),
    source: v.optional(v.union(v.literal("receipt"), v.literal("manual"))),
    status: v.union(v.literal("draft"), v.literal("confirmed")),
    imageStorageId: v.optional(v.id("_storage")),
  },
  handler: async (ctx, args) => {
    const member = await requireMember(ctx);

    // 更新対象の存在・世帯・精算状態を先に確認する
    const existing =
      args.expenseId === undefined
        ? null
        : await findOwnExpense(ctx, member.coupleId, args.expenseId);
    if (args.expenseId !== undefined) {
      if (existing === null) {
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

    // クライアント由来の storageId も member ID と同じく帰属を検証する
    // (他世帯がアップロードした画像を自分の支出に紐付けられないようにする)。
    // あわせて台帳に「参照済み」の印を付け、撮り直しの破棄対象から外す
    if (args.imageStorageId !== undefined) {
      await markUploadUsed(ctx, member.coupleId, args.imageStorageId);
    }

    const totalAmount = calcTotalAmount(items);

    if (existing === null) {
      return await ctx.db.insert("expenses", {
        coupleId: member.coupleId,
        paidBy: args.paidBy,
        storeName,
        purchasedAt: args.purchasedAt,
        totalAmount,
        items,
        imageStorageId: args.imageStorageId,
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
      // 省略時は既存の画像を残す(patchに undefined を渡すとフィールドが消えるため)
      ...(args.imageStorageId === undefined
        ? {}
        : { imageStorageId: args.imageStorageId }),
    });
    return existing._id;
  },
});

// 一覧の1行分。items をそのまま返すと転送量が無駄なので、行の表示に必要な
// フィールドだけに射影する(詳細は expenses.get で読む)。
function toListRow(expense: Doc<"expenses">) {
  return {
    _id: expense._id,
    // 店名は任意項目。未設定なら先頭の品目名を見出しに使う
    title: expense.storeName ?? expense.items[0]?.name ?? "(名称なし)",
    itemCount: expense.items.length,
    purchasedAt: expense.purchasedAt,
    totalAmount: expense.totalAmount,
    paidBy: expense.paidBy,
    status: expense.status,
    settled: expense.settlementId !== undefined,
  };
}

// ホーム(S-003)の支出一覧。購入日の降順で20件ずつページングする。
// フィルタでインデックスを使い分ける:
//   "unsettled" = by_coupleId_and_settlementId_and_deletedAt_and_purchasedAt
//                 (未精算と未削除の両方をインデックス範囲で絞る)
//   "all"       = by_coupleId_and_purchasedAt(論理削除の除外は .filter())
// .filter() は両方に掛けたままにする("all" に必要で、"unsettled" では冗長なだけ)。
// ページを取得したあとに配列から捨てると1ページの件数が削除済みのぶんだけ
// 目減りするため、除外はページング前に適用する。
// ドラフト(未確定)も含めて返し、行にバッジを出す(除外すると確定させる導線が
// 画面から消えてしまう。差額計算からの除外は Phase 7 の精算側で行う)。
export const list = query({
  args: {
    paginationOpts: paginationOptsValidator,
    filter: v.union(v.literal("unsettled"), v.literal("all")),
  },
  handler: async (ctx, args) => {
    const member = await requireMember(ctx);

    const scoped =
      args.filter === "unsettled"
        ? ctx.db
            .query("expenses")
            .withIndex(
              "by_coupleId_and_settlementId_and_deletedAt_and_purchasedAt",
              (q) =>
                q
                  .eq("coupleId", member.coupleId)
                  .eq("settlementId", undefined)
                  .eq("deletedAt", undefined),
            )
        : ctx.db
            .query("expenses")
            .withIndex("by_coupleId_and_purchasedAt", (q) =>
              q.eq("coupleId", member.coupleId),
            );

    const result = await scoped
      .order("desc")
      .filter((q) => q.eq(q.field("deletedAt"), undefined))
      .paginate(args.paginationOpts);

    return { ...result, page: result.page.map(toListRow) };
  },
});

// 支出詳細(S-005)。URLのパスから来た文字列をそのまま受けるため、
// normalizeId で ID の形式を検証する(v.id だと不正な文字列で引数検証エラーになり、
// 画面が「見つかりません」ではなくクラッシュしてしまう)。
// 見つからない・他世帯・削除済みはすべて null(存在を漏らさない)。
export const get = query({
  args: { expenseId: v.string() },
  handler: async (ctx, args) => {
    const member = await requireMember(ctx);
    const expenseId = ctx.db.normalizeId("expenses", args.expenseId);
    if (expenseId === null) {
      return null;
    }
    const expense = await findOwnExpense(ctx, member.coupleId, expenseId);
    if (expense === null) {
      return null;
    }
    return {
      _id: expense._id,
      paidBy: expense.paidBy,
      storeName: expense.storeName,
      purchasedAt: expense.purchasedAt,
      totalAmount: expense.totalAmount,
      items: expense.items,
      source: expense.source,
      status: expense.status,
      settled: expense.settlementId !== undefined,
      hasImage: expense.imageStorageId !== undefined,
    };
  },
});

// レシート画像の署名付きURL(Phase 8で画像が付いてから中身が出る)。
// 画像が無い場合・自世帯の支出でない場合は null。
export const getImageUrl = query({
  args: { expenseId: v.string() },
  handler: async (ctx, args) => {
    const member = await requireMember(ctx);
    const expenseId = ctx.db.normalizeId("expenses", args.expenseId);
    if (expenseId === null) {
      return null;
    }
    const expense = await findOwnExpense(ctx, member.coupleId, expenseId);
    if (expense === null || expense.imageStorageId === undefined) {
      return null;
    }
    return await ctx.storage.getUrl(expense.imageStorageId);
  },
});

// 支出の削除(F-006)。物理削除せず deletedAt を立てる論理削除。
// 精算済みは拒否する(画面側でもボタンを非活性にするが、サーバーでも二重に防ぐ)。
export const remove = mutation({
  args: { expenseId: v.id("expenses") },
  handler: async (ctx, args) => {
    const member = await requireMember(ctx);
    const expense = await findOwnExpense(ctx, member.coupleId, args.expenseId);
    if (expense === null) {
      throw new ConvexError(ERR_NOT_FOUND);
    }
    if (expense.settlementId !== undefined) {
      throw new ConvexError(ERR_SETTLED);
    }
    await ctx.db.patch("expenses", expense._id, { deletedAt: Date.now() });
    return null;
  },
});
