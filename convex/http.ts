import { httpRouter } from "convex/server";
import { ConvexError } from "convex/values";
import { httpAction, ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

// リモートMCPサーバーの内部API(計画書 §4.3)。ここが外部境界:
// Next.js(/mcp route)から「内部シークレット + 検証済みClerk userId」で
// server-to-server 呼び出しされる想定で、Clerk OAuthトークン自体はここまで
// 届かない(D4)。全レスポンスはsnake_case・Cache-Control: no-store・JSON。

const http = httpRouter();

// ---- 共通レスポンス組み立て ------------------------------------------------

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      // MCPクライアント・中間プロキシに家計データをキャッシュさせない
      "Cache-Control": "no-store",
    },
  });
}

type ErrorCode =
  | "unauthorized"
  | "forbidden"
  | "invalid_request"
  | "not_found"
  | "rate_limited"
  | "server_not_configured";

function errorResponse(
  status: number,
  code: ErrorCode,
  message: string,
  extra?: Record<string, unknown>,
): Response {
  return jsonResponse(status, { error: { code, message }, ...extra });
}

// ---- シークレット検証(定数時間比較) ---------------------------------------

// ConvexのV8ランタイムには timingSafeEqual が無いため、XOR累積で自作する
// (計画書 §4.2)。長さの差もXORに畳み込むことで、不一致の理由が長さなのか
// 中身なのかを実行時間から推測しにくくする
function constantTimeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const aBytes = encoder.encode(a);
  const bBytes = encoder.encode(b);
  const length = Math.max(aBytes.length, bBytes.length);
  let diff = aBytes.length ^ bBytes.length;
  for (let i = 0; i < length; i++) {
    const x = i < aBytes.length ? aBytes[i] : 0;
    const y = i < bBytes.length ? bBytes[i] : 0;
    diff |= x ^ y;
  }
  return diff === 0;
}

type SecretCheck = "ok" | "invalid" | "not_configured";

// WARIKAPP_MCP_INTERNAL_SECRET(現行)と WARIKAPP_MCP_INTERNAL_SECRET_PREVIOUS
// (ローテーション中の旧値)の2値を受理する(計画書 §6.3)。両方未設定なら
// fail closedで一律 not_configured(503)。どちらとも一致しなければ invalid(401)
function verifySecret(authorizationHeader: string | null): SecretCheck {
  const current = process.env.WARIKAPP_MCP_INTERNAL_SECRET;
  const previous = process.env.WARIKAPP_MCP_INTERNAL_SECRET_PREVIOUS;
  if (!current && !previous) {
    return "not_configured";
  }
  const prefix = "Bearer ";
  if (authorizationHeader === null || !authorizationHeader.startsWith(prefix)) {
    return "invalid";
  }
  const token = authorizationHeader.slice(prefix.length);
  const matchesCurrent = current !== undefined && constantTimeEqual(token, current);
  const matchesPrevious =
    previous !== undefined && constantTimeEqual(token, previous);
  return matchesCurrent || matchesPrevious ? "ok" : "invalid";
}

// ---- 認証 + レートリミットの共通ラッパー -----------------------------------

// 4エンドポイント共通の入口: シークレット検証 → X-Warikapp-Clerk-User-Id の
// 存在確認 → (エンドポイント固有の処理は run に委譲)。
// run の中で投げた ConvexError({ code: "not_a_member" | "rate_limited" }) は
// ここで403/429に変換する(convex/mcp.ts の requireMcpMember / checkRateLimit
// が投げる形と対応させてある)。
async function withMcpAuth(
  req: Request,
  run: (clerkUserId: string) => Promise<Response>,
): Promise<Response> {
  const secretStatus = verifySecret(req.headers.get("Authorization"));
  if (secretStatus === "not_configured") {
    return errorResponse(
      503,
      "server_not_configured",
      "MCPサーバーの設定が完了していません",
    );
  }
  if (secretStatus === "invalid") {
    return errorResponse(401, "unauthorized", "認証に失敗しました");
  }

  // このヘッダーを信用してよいのはシークレットが一致した場合のみ(検証はここより前)
  const clerkUserId = req.headers.get("X-Warikapp-Clerk-User-Id");
  if (clerkUserId === null || clerkUserId === "") {
    return errorResponse(403, "forbidden", "世帯に参加してから利用してください");
  }

  try {
    return await run(clerkUserId);
  } catch (error) {
    if (error instanceof ConvexError) {
      const data = error.data as
        | { code?: string; retryAfterMs?: number }
        | undefined;
      if (data?.code === "not_a_member") {
        return errorResponse(
          403,
          "forbidden",
          "世帯に参加してから利用してください",
        );
      }
      if (data?.code === "rate_limited") {
        const retryAfterSeconds = Math.max(
          1,
          Math.ceil((data.retryAfterMs ?? 0) / 1000),
        );
        return errorResponse(
          429,
          "rate_limited",
          "しばらく待ってから再試行してください",
          { retry_after_seconds: retryAfterSeconds },
        );
      }
    }
    throw error;
  }
}

// balance/summaryのdirection計算に共通で使う。fromMemberIdは「支払う側」
// (schemaのsettlements.fromMemberIdコメントと同じ意味)
function directionOf(
  fromMemberId: Id<"members"> | null,
  selfMemberId: Id<"members">,
): "even" | "self_pays_partner" | "partner_pays_self" {
  if (fromMemberId === null) {
    return "even";
  }
  return fromMemberId === selfMemberId ? "self_pays_partner" : "partner_pays_self";
}

// ---- パラメータ検証 ---------------------------------------------------------

function parseFilter(raw: string | null): "unsettled" | "all" | null {
  if (raw === null) {
    return "unsettled";
  }
  return raw === "unsettled" || raw === "all" ? raw : null;
}

// YYYY-MM-DD形式 + 実在日(expenses.tsのassertPurchasedAtと同じ往復方式)。
// ただし未来日は禁止しない: date_from/date_toは検索条件であって購入日の
// 入力ではないので、未来日を指定しても単に0件になるだけで拒否する理由がない
function isValidCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

function isValidMonth(value: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

// ---- cursorエンベロープ(計画書 D6・D13) ------------------------------------
//
// base64url(JSON { v: 1, filter, date_from, date_to, c, convex_cursor })。
// サーバーは受信時にfilter/期間/coupleIdが現リクエストと一致するかを検証し、
// 不一致・復号不能はすべて400にする(別条件で発行されたcursorの使い回しを防ぐ)。
// `c` は発行元のcoupleId(テナント分離レビューの多層防御対応): member解決自体が
// 世帯をまたいだ読み取りを防いでいるが、万一の実装ミスに備えて「このcursorを
// 発行した世帯と、いま使おうとしている世帯が一致するか」をcursor自体にも
// 持たせて二重に検証する。

type CursorEnvelope = {
  v: 1;
  filter: "unsettled" | "all";
  date_from: string | null;
  date_to: string | null;
  c: string;
  convex_cursor: string;
};

// UTF-8安全なbase64url変換。中身は英数字のみの想定だが、念のため
// encodeURIComponent/decodeURIComponent を経由しておく
function encodeCursor(envelope: CursorEnvelope): string {
  const json = JSON.stringify(envelope);
  const base64 = btoa(unescape(encodeURIComponent(json)));
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decodeCursor(raw: string): CursorEnvelope | null {
  try {
    const restored = raw.replace(/-/g, "+").replace(/_/g, "/");
    const padLength = (4 - (restored.length % 4)) % 4;
    const padded = restored + "=".repeat(padLength);
    const json = decodeURIComponent(escape(atob(padded)));
    const parsed: unknown = JSON.parse(json);
    if (typeof parsed !== "object" || parsed === null) {
      return null;
    }
    const candidate = parsed as Record<string, unknown>;
    if (
      candidate.v !== 1 ||
      (candidate.filter !== "unsettled" && candidate.filter !== "all") ||
      typeof candidate.convex_cursor !== "string" ||
      typeof candidate.c !== "string" ||
      (candidate.date_from !== null && typeof candidate.date_from !== "string") ||
      (candidate.date_to !== null && typeof candidate.date_to !== "string")
    ) {
      return null;
    }
    return candidate as unknown as CursorEnvelope;
  } catch {
    return null;
  }
}

// ---- (1) GET /mcp/balance --------------------------------------------------

http.route({
  path: "/mcp/balance",
  method: "GET",
  handler: httpAction(async (ctx: ActionCtx, req) => {
    return withMcpAuth(req, async (clerkUserId) => {
      await ctx.runMutation(internal.mcp.checkRateLimit, { clerkUserId });
      const result = await ctx.runQuery(internal.mcp.balance, { clerkUserId });

      return jsonResponse(200, {
        currency: "JPY",
        amount: result.amount,
        direction: directionOf(result.fromMemberId, result.self.memberId),
        self: {
          member_id: result.self.memberId,
          display_name: result.self.displayName,
        },
        partner:
          result.partner === null
            ? null
            : {
                member_id: result.partner.memberId,
                display_name: result.partner.displayName,
              },
        paid_by_self: result.paidBySelf,
        paid_by_partner: result.paidByPartner,
        included_expense_count: result.includedExpenseCount,
        draft_count: result.draftCount,
        truncated: result.truncated,
      });
    });
  }),
});

// ---- (2) GET /mcp/expenses --------------------------------------------------

http.route({
  path: "/mcp/expenses",
  method: "GET",
  handler: httpAction(async (ctx: ActionCtx, req) => {
    return withMcpAuth(req, async (clerkUserId) => {
      const url = new URL(req.url);

      const filter = parseFilter(url.searchParams.get("filter"));
      if (filter === null) {
        return errorResponse(
          400,
          "invalid_request",
          "filter は unsettled または all で指定してください",
        );
      }

      const dateFromParam = url.searchParams.get("date_from");
      const dateToParam = url.searchParams.get("date_to");
      if (dateFromParam !== null && !isValidCalendarDate(dateFromParam)) {
        return errorResponse(
          400,
          "invalid_request",
          "date_from は YYYY-MM-DD 形式の実在する日付で指定してください(例: 2026-08-05)",
        );
      }
      if (dateToParam !== null && !isValidCalendarDate(dateToParam)) {
        return errorResponse(
          400,
          "invalid_request",
          "date_to は YYYY-MM-DD 形式の実在する日付で指定してください(例: 2026-08-05)",
        );
      }
      if (
        dateFromParam !== null &&
        dateToParam !== null &&
        dateFromParam > dateToParam
      ) {
        return errorResponse(
          400,
          "invalid_request",
          "date_from は date_to 以前の日付で指定してください",
        );
      }

      const limitParam = url.searchParams.get("limit");
      let limit = 20;
      if (limitParam !== null) {
        if (!/^\d+$/.test(limitParam) || Number(limitParam) < 1 || Number(limitParam) > 50) {
          return errorResponse(
            400,
            "invalid_request",
            "limit は1〜50の整数で指定してください",
          );
        }
        limit = Number(limitParam);
      }

      // member解決(403判定)を先に済ませ、coupleIdを取得してからcursorを復号する
      // (coupleIdが手に入る前にcursorを検証しない。テナント分離レビューの多層防御対応。
      // checkRateLimitは全エンドポイント共通でmemberを解決するので、その結果を使う)
      const { coupleId } = await ctx.runMutation(internal.mcp.checkRateLimit, {
        clerkUserId,
      });

      const cursorParam = url.searchParams.get("cursor");
      let convexCursor: string | undefined;
      if (cursorParam !== null) {
        const envelope = decodeCursor(cursorParam);
        if (
          envelope === null ||
          envelope.filter !== filter ||
          envelope.date_from !== dateFromParam ||
          envelope.date_to !== dateToParam ||
          envelope.c !== coupleId
        ) {
          return errorResponse(
            400,
            "invalid_request",
            "cursor が無効です。cursor を捨てて最初から取得し直してください",
          );
        }
        convexCursor = envelope.convex_cursor;
      }

      const result = await ctx.runQuery(internal.mcp.listExpenses, {
        clerkUserId,
        filter,
        dateFrom: dateFromParam ?? undefined,
        dateTo: dateToParam ?? undefined,
        cursor: convexCursor,
        limit,
      });

      // 最終ページは欠落ではなく明示的にnullを返す(outputSchemaでの統一。計画書L2)
      const nextCursor = result.isDone
        ? null
        : encodeCursor({
            v: 1,
            filter,
            date_from: dateFromParam,
            date_to: dateToParam,
            c: coupleId,
            convex_cursor: result.continueCursor,
          });

      return jsonResponse(200, {
        currency: "JPY",
        expenses: result.expenses.map((expense) => ({
          id: expense.id,
          title: expense.title,
          purchased_at: expense.purchasedAt,
          total_amount: expense.totalAmount,
          item_count: expense.itemCount,
          source: expense.source,
          paid_by: {
            member_id: expense.paidBy.memberId,
            display_name: expense.paidBy.displayName,
          },
          status: expense.status,
          settled: expense.settled,
        })),
        // .paginate()のnumItemsにlimitをそのまま渡し、返却後の切り詰めはしていない
        // ため「通常limit件だが前後しうる」契約(計画書 D13)
        returned_count: result.expenses.length,
        has_more: !result.isDone,
        next_cursor: nextCursor,
      });
    });
  }),
});

// ---- (3) GET /mcp/summary ---------------------------------------------------

http.route({
  path: "/mcp/summary",
  method: "GET",
  handler: httpAction(async (ctx: ActionCtx, req) => {
    return withMcpAuth(req, async (clerkUserId) => {
      const url = new URL(req.url);
      const month = url.searchParams.get("month");
      if (month === null || !isValidMonth(month)) {
        return errorResponse(
          400,
          "invalid_request",
          "month は YYYY-MM 形式の実在する月で指定してください(例: 2026-08)",
        );
      }

      await ctx.runMutation(internal.mcp.checkRateLimit, { clerkUserId });
      const result = await ctx.runQuery(internal.mcp.monthlySummary, {
        clerkUserId,
        month,
      });

      const self = result.members.find((m) => m.isSelf);
      const selfMemberId = self?.memberId ?? null;

      return jsonResponse(200, {
        currency: "JPY",
        month: result.month,
        included_expense_count: result.includedExpenseCount,
        draft_count: result.draftCount,
        total_amount: result.totalAmount,
        settled_amount: result.settledAmount,
        unsettled_amount: result.unsettledAmount,
        unsettled_balance: {
          amount: result.unsettledBalance.amount,
          direction:
            selfMemberId === null
              ? "even"
              : directionOf(result.unsettledBalance.fromMemberId, selfMemberId),
        },
        members: result.members.map((m) => ({
          member_id: m.memberId,
          display_name: m.displayName,
          is_self: m.isSelf,
          paid_amount: m.paidAmount,
          share_amount: m.shareAmount,
          unsettled_paid_amount: m.unsettledPaidAmount,
        })),
        truncated: result.truncated,
      });
    });
  }),
});

// ---- (4) GET /mcp/expense ----------------------------------------------------

http.route({
  path: "/mcp/expense",
  method: "GET",
  handler: httpAction(async (ctx: ActionCtx, req) => {
    return withMcpAuth(req, async (clerkUserId) => {
      const url = new URL(req.url);
      // idが無い/空文字の場合も含めてexpenseDetail側のnormalizeIdに判定を委ね、
      // 不正・他世帯・削除済みと同じ404に一本化する(存在を漏らさない原則)
      const expenseId = url.searchParams.get("id") ?? "";

      await ctx.runMutation(internal.mcp.checkRateLimit, { clerkUserId });
      const result = await ctx.runQuery(internal.mcp.expenseDetail, {
        clerkUserId,
        expenseId,
      });
      if (result === null) {
        return errorResponse(
          404,
          "not_found",
          "支出が見つかりません。list_expenses で有効な ID を確認してください",
        );
      }

      return jsonResponse(200, {
        currency: "JPY",
        id: result.id,
        store_name: result.storeName,
        purchased_at: result.purchasedAt,
        total_amount: result.totalAmount,
        status: result.status,
        settled: result.settled,
        source: result.source,
        paid_by: {
          member_id: result.paidBy.memberId,
          display_name: result.paidBy.displayName,
        },
        advance_amount: result.advanceAmount,
        items: result.items.map((item) => ({
          name: item.name,
          price: item.price,
          quantity: item.quantity,
          subtotal: item.subtotal,
          shares: item.shares.map((share) => ({
            member_id: share.memberId,
            display_name: share.displayName,
            ratio_percent: share.ratioPercent,
            amount: share.amount,
          })),
        })),
      });
    });
  }),
});

export default http;
