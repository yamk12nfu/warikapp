import { paginationOptsValidator } from "convex/server";
import { ConvexError, v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  QueryCtx,
  MutationCtx,
  env,
} from "./_generated/server";
import { Doc, Id } from "./_generated/dataModel";
import {
  collectUnsettled,
  findPartner,
  summarize,
  MAX_UNSETTLED_EXPENSES,
} from "./settlements";
import { calcAdvanceAmount, calcItemShareAmount } from "../lib/settlement";
import type { SettlementBalance } from "../lib/settlement";
import {
  foldMonth,
  monthDateRange,
  requireYearMonth,
  toMonthExpenseFact,
} from "../lib/month-book";
import { rateLimiter, MCP_READ_LIMIT_NAME } from "./rateLimits";

// リモートMCPサーバー(convex/http.ts)の内部境界。ここに置く関数はすべて
// internalQuery / internalMutation で、httpAction からしか呼ばれない
// (公開 query / mutation は作らない。外部境界は http.ts の httpAction のみ)。
//
// 業務データ(expenses等)への書き込みコードパスはこのファイルに一切作らない。
// 唯一の mutation である checkRateLimit も、書き込み先はレートリミッターの
// コンポーネント内部テーブルだけで、業務テーブルには触れない(計画書 D12)。

// http.ts のエラー分岐(403 / 429 / 400)がこのコードだけを見て判定できるよう、
// mcp.ts から投げるエラーは必ずこの形の ConvexError にする
type McpErrorCode = "not_a_member" | "rate_limited" | "invalid_cursor";

function mcpError(
  code: McpErrorCode,
  extra?: { retryAfterMs?: number },
): ConvexError<{ code: McpErrorCode; retryAfterMs?: number }> {
  return new ConvexError({ code, ...extra });
}

// .paginate() が無効なcursorに対して投げるエラーの判定(レビュー指摘 中2)。
// http.ts側で署名検証・条件一致まで通ったcursorでも、内部のconvex_cursor自体が
// .paginate()の契約に合わないことがありうる(想定外の値・将来の形式変更等)。
// 本番のConvexランタイムはメッセージに"InvalidCursor"を含む形で投げる
// (@modelcontextprotocol非依存、convexのreact hook実装(use_paginated_query.ts)
// の判定ロジックと同じ基準)。convex-test(このテストで使うシミュレータ)は
// 内部でcursor文字列をJSON.parseするため不正なcursorはSyntaxErrorになるが、
// syscall境界を越える際に `throw new Error(e.message)` で再ラップされ
// (node_modules/convex/src/server/impl/syscall.ts)name情報は失われ
// メッセージだけが残る(実測: "Unexpected token ... is not valid JSON")。
// nameとmessageの両方を見て判定し、どちらであっても500ではなく400にする
// (fail closed)
export function isInvalidCursorError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  // 本番ランタイムはメッセージではなく構造化データだけを持つ ConvexError で
  // 投げることがある(convex公式の use_paginated_query.ts と同じ判定基準)。
  if (
    error instanceof ConvexError &&
    typeof error.data === "object" &&
    error.data !== null &&
    (error.data as Record<string, unknown>).isConvexSystemError === true &&
    (error.data as Record<string, unknown>).paginationError === "InvalidCursor"
  ) {
    return true;
  }
  return (
    error.name === "SyntaxError" ||
    error.message.includes("InvalidCursor") ||
    error.message.includes("is not valid JSON")
  );
}

// 検証済みClerk userId(clerkUserId)から自世帯のmemberを解決する。
// tokenIdentifierの実形式は "<issuer>|<subject>"(dev/production 実データで確認済み。
// 計画書 §5.5)。CLERK_JWT_ISSUER_DOMAIN 未設定・member未解決・(通常起こりえないが)
// tokenIdentifier重複による .unique() の例外は、すべて同じ not_a_member として
// fail closed にする(http.ts 側でこれを一律 403 に変換する。計画書 D4)。
async function requireMcpMember(
  ctx: QueryCtx | MutationCtx,
  clerkUserId: string,
): Promise<Doc<"members">> {
  const issuerDomain = env.CLERK_JWT_ISSUER_DOMAIN;
  if (issuerDomain === undefined || issuerDomain === "") {
    throw mcpError("not_a_member");
  }
  const tokenIdentifier = `${issuerDomain}|${clerkUserId}`;
  let member: Doc<"members"> | null;
  try {
    member = await ctx.db
      .query("members")
      .withIndex("by_tokenIdentifier", (q) =>
        q.eq("tokenIdentifier", tokenIdentifier),
      )
      .unique();
  } catch {
    // tokenIdentifier が重複しているなど、.unique() が例外を投げた場合も
    // 「本人と確定できない」という点では未所属と同じなので fail closed にする
    throw mcpError("not_a_member");
  }
  if (member === null) {
    throw mcpError("not_a_member");
  }
  return member;
}

// member本人 + パートナー(いれば)+ IDから引ける表示名マップ。
// 4つの internalQuery すべてで「支払者・負担者の表示名を出す」ために使うので集約した
async function loadCoupleContext(ctx: QueryCtx, clerkUserId: string) {
  const member = await requireMcpMember(ctx, clerkUserId);
  const partner = await findPartner(ctx, member);
  const membersById = new Map<Id<"members">, Doc<"members">>();
  membersById.set(member._id, member);
  if (partner !== null) {
    membersById.set(partner._id, partner);
  }
  return { member, partner, membersById };
}

// paidBy / shares[].memberId は expenses.save 時に自世帯メンバーとして検証済み
// (assertCoupleMemberIds)なので、通常は必ず membersById に見つかる。想定外の
// 状態(例: 過去にメンバーが入れ替わったなど、現行機能には無い経路)に備えて
// "?" にフォールバックする(表示上の劣化に留め、リクエスト自体は失敗させない)
function displayNameOf(
  membersById: Map<Id<"members">, Doc<"members">>,
  memberId: Id<"members">,
): string {
  return membersById.get(memberId)?.displayName ?? "?";
}

// レートリミット専用の内部書き込み(計画書 D12)。
// 書き込み先はレートリミッターコンポーネントの内部テーブルのみで、
// members/expenses などの業務テーブルには一切書き込まない(読み取り専用の
// 構造的保証)。member単位でキーイングするため、先に requireMcpMember で
// member を解決してから rateLimiter.limit を呼ぶ(未所属ユーザーの呼び出しは
// レートリミットの消費対象にもならない)。
export const checkRateLimit = internalMutation({
  args: { clerkUserId: v.string() },
  handler: async (ctx, args) => {
    const member = await requireMcpMember(ctx, args.clerkUserId);
    const result = await rateLimiter.limit(ctx, MCP_READ_LIMIT_NAME, {
      key: member._id,
    });
    if (!result.ok) {
      throw mcpError("rate_limited", { retryAfterMs: result.retryAfter });
    }
    // GET /mcp/expenses のcursorエンベロープにcoupleIdを束縛する検証(http.ts)は
    // 「member解決(403判定)の直後、cursorを復号する前」に行う必要があるため、
    // ここで解決済みのmemberのcoupleIdをあわせて返す(テナント分離の多層防御。
    // 他世帯で発行されたnext_cursorを使い回されても400で弾けるようにする)。
    // 他のエンドポイントはこの戻り値を使わないが、rate limit確認は全エンドポイント
    // 共通でmemberを解決済みなので、ここに載せるのが最小の変更で済む
    return { coupleId: member.coupleId };
  },
});

// GET /mcp/balance — 未精算差額(全期間の現在残高)。
// 既存の settlements.currentBalance と同じ collectUnsettled + summarize を再利用し、
// Web画面の表示と1円単位で一致させる
export const balance = internalQuery({
  args: { clerkUserId: v.string() },
  handler: async (ctx, args) => {
    const member = await requireMcpMember(ctx, args.clerkUserId);
    const partner = await findPartner(ctx, member);
    const { expenses, truncated } = await collectUnsettled(
      ctx,
      member.coupleId,
    );
    const summary = summarize(member._id, partner?._id ?? null, expenses, truncated);

    return {
      amount: summary.amount,
      fromMemberId: summary.fromMemberId,
      self: { memberId: member._id, displayName: member.displayName },
      partner:
        partner === null
          ? null
          : { memberId: partner._id, displayName: partner.displayName },
      paidBySelf: summary.paidBySelf,
      paidByPartner: summary.paidByPartner,
      includedExpenseCount: summary.expenseCount,
      draftCount: summary.draftCount,
      truncated: summary.truncated,
    };
  },
});

const LIST_FILTER = v.union(v.literal("unsettled"), v.literal("all"));

// GET /mcp/expenses — 支出一覧。
// paginationOptsは http.ts でエンベロープから取り出した「生のconvexカーソル」+
// limitのclamp結果をそのまま組み立てて渡す(エンベロープ自体の組み立て・検証は
// http.ts側の責務。ここはConvexのpaginationOptsValidator契約だけを見る。
// Convexガイドライン: paginationOptsValidatorで検証し、変更せず
// .paginate(args.paginationOpts)へ渡す。レビュー指摘 中3)。日付範囲はfilterに
// 応じて別々のインデックスのpurchasedAt段に適用する(§4.4: unsettledは既存
// インデックス、allは新設インデックス)
export const listExpenses = internalQuery({
  args: {
    clerkUserId: v.string(),
    filter: LIST_FILTER,
    dateFrom: v.optional(v.string()),
    dateTo: v.optional(v.string()),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const { member, membersById } = await loadCoupleContext(
      ctx,
      args.clerkUserId,
    );

    const scoped =
      args.filter === "unsettled"
        ? ctx.db
            .query("expenses")
            .withIndex(
              "by_coupleId_and_settlementId_and_deletedAt_and_purchasedAt",
              (q) => {
                const base = q
                  .eq("coupleId", member.coupleId)
                  .eq("settlementId", undefined)
                  .eq("deletedAt", undefined);
                if (args.dateFrom !== undefined && args.dateTo !== undefined) {
                  return base
                    .gte("purchasedAt", args.dateFrom)
                    .lte("purchasedAt", args.dateTo);
                }
                if (args.dateFrom !== undefined) {
                  return base.gte("purchasedAt", args.dateFrom);
                }
                if (args.dateTo !== undefined) {
                  return base.lte("purchasedAt", args.dateTo);
                }
                return base;
              },
            )
        : ctx.db
            .query("expenses")
            .withIndex("by_coupleId_and_deletedAt_and_purchasedAt", (q) => {
              const base = q
                .eq("coupleId", member.coupleId)
                .eq("deletedAt", undefined);
              if (args.dateFrom !== undefined && args.dateTo !== undefined) {
                return base
                  .gte("purchasedAt", args.dateFrom)
                  .lte("purchasedAt", args.dateTo);
              }
              if (args.dateFrom !== undefined) {
                return base.gte("purchasedAt", args.dateFrom);
              }
              if (args.dateTo !== undefined) {
                return base.lte("purchasedAt", args.dateTo);
              }
              return base;
            });

    // paginationOptsは変更せずそのまま.paginate()へ渡す(計画書 D13・Convex
    // ガイドライン)。返却後に配列を切り詰めるとcontinueCursorとの対応がずれ、
    // 切り詰めた支出が次ページにも出ず永久に欠落する
    let result;
    try {
      result = await scoped.order("desc").paginate(args.paginationOpts);
    } catch (error) {
      if (isInvalidCursorError(error)) {
        throw mcpError("invalid_cursor");
      }
      throw error;
    }

    return {
      expenses: result.page.map((expense) => ({
        id: expense._id,
        // 店名は任意項目。未設定なら先頭の品目名を見出しにする(expenses.listと同じ規則)
        title: expense.storeName ?? expense.items[0]?.name ?? "(名称なし)",
        purchasedAt: expense.purchasedAt,
        totalAmount: expense.totalAmount,
        itemCount: expense.items.length,
        source: expense.source,
        paidBy: {
          memberId: expense.paidBy,
          displayName: displayNameOf(membersById, expense.paidBy),
        },
        status: expense.status,
        settled: expense.settlementId !== undefined,
      })),
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

// foldMonth の差額は string の memberId で返る。http.ts は Id として比較する。
function mcpUnsettledBalance(
  viewerId: Id<"members">,
  partnerId: Id<"members"> | null,
  balance: SettlementBalance,
): SettlementBalance<Id<"members">> {
  const amount = balance.amount;
  if (
    partnerId === null ||
    balance.fromMemberId === null ||
    balance.toMemberId === null
  ) {
    return { fromMemberId: null, toMemberId: null, amount };
  }
  const known = (id: string): Id<"members"> => {
    if (id === viewerId) {
      return viewerId;
    }
    if (id === partnerId) {
      return partnerId;
    }
    throw new Error("unsettled balance names a member outside the couple");
  };
  return {
    fromMemberId: known(balance.fromMemberId),
    toMemberId: known(balance.toMemberId),
    amount,
  };
}

// GET /mcp/summary — 月次サマリー。
// 金額集計はconfirmedのみ(draftは件数だけ。Webの差額計算と同じ扱い)。
// unsettled_balanceはその月のconfirmed×未精算だけを見た
// 「月内の誰が誰にいくら」で、get_unsettled_balance(全期間の現在残高)とは別物。
// カテゴリは返さない。上限超過は従来どおり部分合計 + truncated:true。
export const monthlySummary = internalQuery({
  args: { clerkUserId: v.string(), month: v.string() },
  handler: async (ctx, args) => {
    const member = await requireMcpMember(ctx, args.clerkUserId);
    const partner = await findPartner(ctx, member);
    const month = requireYearMonth(args.month);
    const { from, to } = monthDateRange(month);

    // 上限+1件読んで「まだ続きがあるか」を判定する(collectUnsettledと同じパターン)。
    // 200件の根拠(支出1件の読み取りバイト上限)はsettlements.tsのコメントを参照
    const rows = await ctx.db
      .query("expenses")
      .withIndex("by_coupleId_and_deletedAt_and_purchasedAt", (q) =>
        q
          .eq("coupleId", member.coupleId)
          .eq("deletedAt", undefined)
          .gte("purchasedAt", from)
          .lte("purchasedAt", to),
      )
      .take(MAX_UNSETTLED_EXPENSES + 1);

    const truncated = rows.length > MAX_UNSETTLED_EXPENSES;
    const expenses = truncated ? rows.slice(0, MAX_UNSETTLED_EXPENSES) : rows;
    const folded = foldMonth(
      month,
      expenses.map((expense) => toMonthExpenseFact(expense)),
      member._id,
      partner?._id ?? null,
    );

    const viewer = folded.members[0];
    const members = [
      {
        memberId: member._id,
        displayName: member.displayName,
        isSelf: true,
        paidAmount: viewer.paidAmount,
        shareAmount: viewer.shareAmount,
        unsettledPaidAmount: viewer.unsettledPaidAmount,
      },
    ];
    if (partner !== null) {
      const partnerFold = folded.members[1];
      if (partnerFold === undefined) {
        throw new Error("foldMonth omitted the partner");
      }
      members.push({
        memberId: partner._id,
        displayName: partner.displayName,
        isSelf: false,
        paidAmount: partnerFold.paidAmount,
        shareAmount: partnerFold.shareAmount,
        unsettledPaidAmount: partnerFold.unsettledPaidAmount,
      });
    }

    return {
      month: folded.month,
      includedExpenseCount: folded.confirmedCount,
      draftCount: folded.draftCount,
      totalAmount: folded.totalAmount,
      settledAmount: folded.settledAmount,
      unsettledAmount: folded.unsettledAmount,
      unsettledBalance: mcpUnsettledBalance(
        member._id,
        partner?._id ?? null,
        folded.unsettledBalance,
      ),
      members,
      truncated,
    };
  },
});

// GET /mcp/expense?id=... — 品目内訳。
// idの形式検証(normalizeId)・他世帯・論理削除済みはすべてnullを返す(存在を
// 漏らさない。expenses.getと同じ原則)。一律404にする変換はhttp.ts側で行う
export const expenseDetail = internalQuery({
  args: { clerkUserId: v.string(), expenseId: v.string() },
  handler: async (ctx, args) => {
    const { member, membersById } = await loadCoupleContext(
      ctx,
      args.clerkUserId,
    );

    const expenseId = ctx.db.normalizeId("expenses", args.expenseId);
    if (expenseId === null) {
      return null;
    }
    const expense = await ctx.db.get("expenses", expenseId);
    if (
      expense === null ||
      expense.coupleId !== member.coupleId ||
      expense.deletedAt !== undefined
    ) {
      return null;
    }

    return {
      id: expense._id,
      storeName: expense.storeName ?? null,
      purchasedAt: expense.purchasedAt,
      totalAmount: expense.totalAmount,
      status: expense.status,
      settled: expense.settlementId !== undefined,
      source: expense.source,
      paidBy: {
        memberId: expense.paidBy,
        displayName: displayNameOf(membersById, expense.paidBy),
      },
      advanceAmount: calcAdvanceAmount(expense.paidBy, expense.items),
      items: expense.items.map((item) => ({
        name: item.name,
        price: item.price,
        quantity: item.quantity,
        subtotal: item.price * item.quantity,
        shares: item.shares.map((share) => ({
          memberId: share.memberId,
          displayName: displayNameOf(membersById, share.memberId),
          ratioPercent: share.ratioPercent,
          amount: calcItemShareAmount(item, share.memberId),
        })),
      })),
    };
  },
});
