import { paginationOptsValidator } from "convex/server";
import { ConvexError, v } from "convex/values";
import { mutation, query, QueryCtx, MutationCtx } from "./_generated/server";
import { Doc, Id } from "./_generated/dataModel";
import { requireMember } from "./lib/auth";
import { calcAdvanceAmount, calcNetBalance } from "../lib/settlement";

// 精算(F-007)。未精算支出から世帯全体の差額を出し、精算実行で区切る。
// 画面に出すエラーは ConvexError で投げる(本番でも素の Error はメッセージが
// クライアントに届かず「Server Error」に伏せられるため)。

const MAX_MEMBERS = 2; // 世帯の上限2名(V-203)
const MAX_MEMO_LENGTH = 100;

// 1回の精算が対象にする未精算支出の上限。
// ガイドラインは .collect()(件数無制限の読み取り)を禁じている。かといって
// 上限超過をエラーにすると、差額が表示できないうえ精算もできない詰みになるため、
// 「古い順に MAX_UNSETTLED_EXPENSES 件までを1回の精算の対象として切り出し、
// あふれたぶんは次回の精算に回す」方針にした(truncated で画面に伝える)。
// 200件とした根拠は読み取りバイト数。支出1件は最大でも
// 100品目 × (品目名50文字 + 金額・数量 + 2名の負担割合) ≒ 35KB(expenses.ts の
// MAX_ITEMS などの上限から算出)なので、200件でも約7MBとConvexの
// トランザクション読み取り上限(16MiB)に収まる。件数だけ見て500件などにすると、
// 最大サイズの支出が並んだ最悪ケースで上限を超えて query ごと落ちる。
// 2人世帯なら200件は2ヶ月以上ぶんの支出に相当し、実運用では到達しない。
const MAX_UNSETTLED_EXPENSES = 200;

const ERR_NO_PARTNER = "パートナーが参加してから精算してください";
const ERR_DRAFT_REMAINS = "未確定のレシートがあります"; // V-701
const ERR_NO_TARGET = "精算対象がありません"; // V-701 / V-702
const ERR_MEMO_TOO_LONG = "メモは100文字以内で入力してください";
// 他世帯の精算を指定された場合も「存在しない」と同じ文言にする(存在を漏らさない)
const ERR_NOT_FOUND = "精算が見つかりません";
const ERR_NOT_LATEST = "直近の精算のみ取り消せます";
const ERR_CANCEL_MISMATCH =
  "精算の対象が変わっているため取り消せません。時間をおいて再度お試しください";
// V-702: 確認画面に出ていた差額と、実行時にサーバーが計算した差額が違う場合
const ERR_AMOUNT_CHANGED =
  "精算対象が変わりました。内容を確認して、もう一度お試しください";

// 自分以外の世帯メンバー。招待前(1名)の世帯では null
async function findPartner(
  ctx: QueryCtx | MutationCtx,
  member: Doc<"members">,
): Promise<Doc<"members"> | null> {
  const members = await ctx.db
    .query("members")
    .withIndex("by_coupleId", (q) => q.eq("coupleId", member.coupleId))
    .take(MAX_MEMBERS);
  return members.find((m) => m._id !== member._id) ?? null;
}

// 未精算(settlementId 未設定)・未削除の支出を購入日の古い順に読む。
// 上限の扱いは MAX_UNSETTLED_EXPENSES のコメントを参照。currentBalance と
// execute が同じ集合を見るよう、取得条件と並び順はこの関数に集約する。
// 論理削除の除外は .filter() ではなくインデックス範囲で行う(.filter() だと
// 走査した行は読み取りに数えられるため、削除済みが溜まるほど走査量が増える)。
async function collectUnsettled(
  ctx: QueryCtx | MutationCtx,
  coupleId: Id<"couples">,
): Promise<{ expenses: Doc<"expenses">[]; truncated: boolean }> {
  // 上限+1件読んで「まだ続きがあるか」を判定する
  const rows = await ctx.db
    .query("expenses")
    .withIndex(
      "by_coupleId_and_settlementId_and_deletedAt_and_purchasedAt",
      (q) =>
        q
          .eq("coupleId", coupleId)
          .eq("settlementId", undefined)
          .eq("deletedAt", undefined),
    )
    .take(MAX_UNSETTLED_EXPENSES + 1);

  const truncated = rows.length > MAX_UNSETTLED_EXPENSES;
  return {
    expenses: truncated ? rows.slice(0, MAX_UNSETTLED_EXPENSES) : rows,
    truncated,
  };
}

type Summary = {
  amount: number;
  fromMemberId: Id<"members"> | null;
  toMemberId: Id<"members"> | null;
  expenseCount: number;
  draftCount: number;
  truncated: boolean;
  // 未精算(確定済み)支出のうち、それぞれが支払った合計。
  // ホームの差額カードで支払い比率(天秤バー)を描くのに使う
  paidBySelf: number;
  paidByPartner: number;
};

// 未精算支出から差額サマリーを組み立てる。
// ドラフト(未確定)は金額が変わりうるので差額には含めず、件数だけ返して
// 画面の警告と V-701 のガードに使う(一覧に出す判断は expenses.list 側)。
function summarize(
  selfId: Id<"members">,
  partnerId: Id<"members"> | null,
  expenses: Doc<"expenses">[],
  truncated: boolean,
): Summary {
  const confirmed = expenses.filter((e) => e.status === "confirmed");
  const balance =
    partnerId === null
      ? { fromMemberId: null, toMemberId: null, amount: 0 }
      : calcNetBalance(selfId, partnerId, confirmed);
  const paidTotal = (memberId: Id<"members"> | null) =>
    memberId === null
      ? 0
      : confirmed
          .filter((e) => e.paidBy === memberId)
          .reduce((total, e) => total + e.totalAmount, 0);
  return {
    ...balance,
    expenseCount: confirmed.length,
    draftCount: expenses.length - confirmed.length,
    truncated,
    paidBySelf: paidTotal(selfId),
    paidByPartner: paidTotal(partnerId),
  };
}

// ホーム(S-003)に常時表示する未精算差額。
// 「誰が誰にいくら」を返し、amount が0なら精算不要(from/to は null)。
export const currentBalance = query({
  args: {},
  handler: async (ctx): Promise<Summary> => {
    const member = await requireMember(ctx);
    const partner = await findPartner(ctx, member);
    const { expenses, truncated } = await collectUnsettled(
      ctx,
      member.coupleId,
    );
    return summarize(member._id, partner?._id ?? null, expenses, truncated);
  },
});

// 精算画面(S-007)。差額に加えて、今回の対象になる支出の一覧と内訳を返す。
// 一覧は購入日の新しい順(collectUnsettled は古い順に読むので反転する)。
export const pending = query({
  args: {},
  handler: async (ctx) => {
    const member = await requireMember(ctx);
    const partner = await findPartner(ctx, member);
    const { expenses, truncated } = await collectUnsettled(
      ctx,
      member.coupleId,
    );
    const summary = summarize(
      member._id,
      partner?._id ?? null,
      expenses,
      truncated,
    );

    return {
      ...summary,
      expenses: expenses
        .filter((e) => e.status === "confirmed")
        .reverse()
        .map((expense) => ({
          _id: expense._id,
          // 店名は任意項目。未設定なら先頭の品目名を見出しにする(expenses.list と同じ)
          title: expense.storeName ?? expense.items[0]?.name ?? "(名称なし)",
          purchasedAt: expense.purchasedAt,
          totalAmount: expense.totalAmount,
          paidBy: expense.paidBy,
          // この支出で支払者が相手のぶんを立て替えた額
          advanceAmount: calcAdvanceAmount(expense.paidBy, expense.items),
        })),
    };
  },
});

function normalizeMemo(raw: string | undefined): string | undefined {
  const memo = (raw ?? "").trim();
  if (memo.length === 0) {
    return undefined; // 任意項目
  }
  if (memo.length > MAX_MEMO_LENGTH) {
    throw new ConvexError(ERR_MEMO_TOO_LONG);
  }
  return memo;
}

// 精算の実行(S-007)。mutationは自動でトランザクションなので、
// 「対象の確定 → 精算レコード作成 → 支出への紐付け」を1つの関数に素直に書ける。
// V-702(二重実行防止): 先に走ったほうが対象支出すべてに settlementId を付けるため、
// 後続は対象0件になって ERR_NO_TARGET で失敗する(UI側でもボタンを無効化する)。
//
// expected* は「確認画面に出ていた内容」。金額の決定には一切使わず(差額は必ず
// サーバー側で計算し直す)、食い違ったら実行を中止するためだけに使う。
// 確認直後にパートナーが支出を追加・変更した場合に、ユーザーが見ていない内容で
// 精算してしまうのを防ぐ(要件 V-702「競合時は再計算して確認画面を再表示」)。
// 金額だけでなく向きと件数も見る: 金額が同じまま支払う側が入れ替わるケースや、
// 対象が差し替わって偶然同額になるケースを金額の比較だけでは検出できないため。
export const execute = mutation({
  args: {
    memo: v.optional(v.string()),
    expectedAmount: v.number(),
    expectedFromMemberId: v.union(v.id("members"), v.null()),
    expectedExpenseCount: v.number(),
  },
  handler: async (ctx, args): Promise<Id<"settlements">> => {
    const member = await requireMember(ctx);
    const memo = normalizeMemo(args.memo);

    const partner = await findPartner(ctx, member);
    if (partner === null) {
      // 相手がいなければ立て替えも差額も発生しない
      throw new ConvexError(ERR_NO_PARTNER);
    }

    const { expenses } = await collectUnsettled(ctx, member.coupleId);

    // V-701: 未確定のレシートが残っていたら拒否する(金額が変わりうるため)
    if (expenses.some((e) => e.status === "draft")) {
      throw new ConvexError(ERR_DRAFT_REMAINS);
    }
    if (expenses.length === 0) {
      throw new ConvexError(ERR_NO_TARGET);
    }

    // クライアントの表示値は信用せず、サーバー側で差額を計算し直す
    const balance = calcNetBalance(member._id, partner._id, expenses);

    // 計算し直した結果が確認画面の表示と違う = 確認後に対象が変わった(V-702)
    if (
      balance.amount !== args.expectedAmount ||
      balance.fromMemberId !== args.expectedFromMemberId ||
      expenses.length !== args.expectedExpenseCount
    ) {
      throw new ConvexError(ERR_AMOUNT_CHANGED);
    }

    // 差額0でも「ここで区切る」ことに意味があるので実行を許す。方向に意味が
    // ないため、実行者 → パートナー の向きで記録する
    const settlementId = await ctx.db.insert("settlements", {
      coupleId: member.coupleId,
      fromMemberId: balance.fromMemberId ?? member._id,
      toMemberId: balance.toMemberId ?? partner._id,
      amount: balance.amount,
      memo,
      settledBy: member._id,
      expenseCount: expenses.length,
    });

    for (const expense of expenses) {
      await ctx.db.patch("expenses", expense._id, { settlementId });
    }
    return settlementId;
  },
});

// 精算履歴(S-008)。新しい順に20件ずつページングする
export const list = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const member = await requireMember(ctx);
    const result = await ctx.db
      .query("settlements")
      .withIndex("by_coupleId", (q) => q.eq("coupleId", member.coupleId))
      .order("desc")
      .paginate(args.paginationOpts);

    return {
      ...result,
      page: result.page.map((settlement) => ({
        _id: settlement._id,
        settledAt: settlement._creationTime,
        fromMemberId: settlement.fromMemberId,
        toMemberId: settlement.toMemberId,
        amount: settlement.amount,
        memo: settlement.memo,
        expenseCount: settlement.expenseCount,
      })),
    };
  },
});

// 精算の取り消し(S-008)。直近1件のみ。対象支出の settlementId を外してから
// 精算レコードを消す。取り消すと未精算に戻るので、差額表示も自動で復活する。
export const cancel = mutation({
  args: { settlementId: v.id("settlements") },
  handler: async (ctx, args) => {
    const member = await requireMember(ctx);
    const settlement = await ctx.db.get("settlements", args.settlementId);
    if (settlement === null || settlement.coupleId !== member.coupleId) {
      throw new ConvexError(ERR_NOT_FOUND);
    }

    const latest = await ctx.db
      .query("settlements")
      .withIndex("by_coupleId", (q) => q.eq("coupleId", member.coupleId))
      .order("desc")
      .first();
    if (latest === null || latest._id !== settlement._id) {
      throw new ConvexError(ERR_NOT_LATEST);
    }

    // 1回の精算が抱える件数は execute 側の上限と同じなので、同じ値で有界に読む
    const settled = await ctx.db
      .query("expenses")
      .withIndex(
        "by_coupleId_and_settlementId_and_deletedAt_and_purchasedAt",
        (q) =>
          q
            .eq("coupleId", member.coupleId)
            .eq("settlementId", settlement._id)
            .eq("deletedAt", undefined),
      )
      // 上限+1件読む。ちょうど上限件数だけ読めたときに「本当に上限件数なのか、
      // それ以上あって切れたのか」を区別できないと、下の件数一致の検査が
      // すり抜けてしまう
      .take(MAX_UNSETTLED_EXPENSES + 1);

    // 精算時に数えた件数と一致しなければ、この取り消しでは戻しきれない支出が
    // ある(= settlementId だけが残った孤児レコードを作る)。精算済み支出は
    // 編集も削除もできないので通常は起こりえないが、取りこぼすくらいなら
    // 取り消し全体を失敗させる
    if (settled.length !== settlement.expenseCount) {
      throw new ConvexError(ERR_CANCEL_MISMATCH);
    }

    for (const expense of settled) {
      // undefined を渡すとフィールドが消える = 未精算に戻る
      await ctx.db.patch("expenses", expense._id, { settlementId: undefined });
    }

    await ctx.db.delete("settlements", settlement._id);
    return null;
  },
});
