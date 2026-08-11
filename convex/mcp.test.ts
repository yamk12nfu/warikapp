/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { encodeCursor } from "./http";
import { isInvalidCursorError } from "./mcp";
import { ConvexError } from "convex/values";

const modules = import.meta.glob("./**/*.ts");

// convex/mcp.ts・convex/http.ts(リモートMCPサーバーの内部API)のテスト。
// 認証はConvexの identity 機構(t.withIdentity)を経由せず、http.ts が組み立てる
// 「内部シークレット + X-Warikapp-Clerk-User-Id ヘッダー」でmemberを解決するため、
// t.fetch() でHTTP actionを直接叩く(計画書 §7.1)。

const ISSUER = "https://clerk.test";
const identity = (name: string) => ({
  issuer: ISSUER,
  subject: name,
  tokenIdentifier: `${ISSUER}|${name}`,
});

const ALICE = identity("alice");
const BOB = identity("bob");
const CAROL = identity("carol");
const DAVE = identity("dave");

const SECRET = "test-secret-current-value";
const PREVIOUS_SECRET = "test-secret-previous-value";

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

// requireMcpMember は "${CLERK_JWT_ISSUER_DOMAIN}|${clerkUserId}" で
// tokenIdentifierを組み立てるので、ISSUERをそのままCLERK_JWT_ISSUER_DOMAINに使う
// (identity() が組み立てるtokenIdentifierと一致させるため)
beforeEach(() => {
  vi.stubEnv("CLERK_JWT_ISSUER_DOMAIN", ISSUER);
  vi.stubEnv("WARIKAPP_MCP_INTERNAL_SECRET", SECRET);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function setup() {
  const t = convexTest(schema, modules);
  // レートリミッターはコンポーネント(別テーブル)なのでテストにも登録が要る
  rateLimiterTest.register(t);
  return t;
}

// サーバー側の未来日判定はJST基準なので、テストの日付もJSTの相対値で組む
// (絶対日付をハードコードすると実行日によって「未来日」エラーになりうる)
const jstDate = (offsetDays = 0) =>
  new Date(Date.now() + JST_OFFSET_MS + offsetDays * DAY_MS)
    .toISOString()
    .slice(0, 10);

// 当月初日と、その前日(先月末日)を相対計算で求める。実行日に依存しない
function monthBoundary(): {
  thisMonth: string;
  thisMonthFirstDay: string;
  prevMonthLastDay: string;
} {
  const now = new Date(Date.now() + JST_OFFSET_MS);
  const firstDayOfThisMonth = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
  );
  const lastDayOfPrevMonth = new Date(firstDayOfThisMonth.getTime() - DAY_MS);
  const thisMonthFirstDay = firstDayOfThisMonth.toISOString().slice(0, 10);
  return {
    thisMonth: thisMonthFirstDay.slice(0, 7),
    thisMonthFirstDay,
    prevMonthLastDay: lastDayOfPrevMonth.toISOString().slice(0, 10),
  };
}

type FetchOptions = {
  clerkUserId?: string;
  authorization?: string | null; // 省略時は既定のBearer <SECRET>。nullで意図的に省く
};

async function fetchMcp(
  t: ReturnType<typeof convexTest>,
  path: string,
  options: FetchOptions = {},
) {
  const headers: Record<string, string> = {};
  if (options.authorization !== null) {
    headers.Authorization = options.authorization ?? `Bearer ${SECRET}`;
  }
  if (options.clerkUserId !== undefined) {
    headers["X-Warikapp-Clerk-User-Id"] = options.clerkUserId;
  }
  const response = await t.fetch(path, { headers });
  const text = await response.text();
  return {
    status: response.status,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    body: (text.length > 0 ? JSON.parse(text) : null) as any,
  };
}

// cursorエンベロープの署名検証テスト用。http.tsの内部base64url変換と同じ実装を
// あえて独立に持つ(攻撃者視点のシミュレーションであって、実装の使い回しでは
// 意味がないため)
function base64UrlEncodeJson(value: unknown): string {
  const base64 = btoa(unescape(encodeURIComponent(JSON.stringify(value))));
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecodeJson(base64url: string): Record<string, unknown> {
  const restored = base64url.replace(/-/g, "+").replace(/_/g, "/");
  const padded = restored + "=".repeat((4 - (restored.length % 4)) % 4);
  return JSON.parse(decodeURIComponent(escape(atob(padded)))) as Record<string, unknown>;
}

type Members = {
  self: { _id: Id<"members">; displayName: string };
  partner: { _id: Id<"members">; displayName: string };
};

// 2名の世帯を作り、双方の memberId を返す(settlements.test.ts と同じ形)
async function setupCouple(
  t: ReturnType<typeof convexTest>,
  owner = ALICE,
  joiner = BOB,
  ownerName = "あきこ",
  joinerName = "ぼぶ",
): Promise<Members> {
  const invitation = await t
    .withIdentity(owner)
    .mutation(api.couples.createCouple, { displayName: ownerName });
  await t.withIdentity(joiner).mutation(api.couples.joinCouple, {
    code: invitation.code,
    displayName: joinerName,
  });
  const household = await t
    .withIdentity(owner)
    .query(api.couples.household, {});
  if (household.partner === null) {
    throw new Error("パートナーが参加できていない");
  }
  return { self: household.self, partner: household.partner };
}

const split = (members: Members) => [
  { memberId: members.self._id, ratioPercent: 50 },
  { memberId: members.partner._id, ratioPercent: 50 },
];

async function addExpense(
  t: ReturnType<typeof convexTest>,
  members: Members,
  who: typeof ALICE,
  overrides: Partial<{
    paidBy: Id<"members">;
    price: number;
    storeName: string;
    itemName: string;
    purchasedAt: string;
    status: "draft" | "confirmed";
    shares: { memberId: Id<"members">; ratioPercent: number }[];
  }> = {},
) {
  return await t.withIdentity(who).mutation(api.expenses.save, {
    paidBy: overrides.paidBy ?? members.self._id,
    storeName: overrides.storeName,
    purchasedAt: overrides.purchasedAt ?? jstDate(),
    items: [
      {
        name: overrides.itemName ?? "食材",
        price: overrides.price ?? 5000,
        quantity: 1,
        shares: overrides.shares ?? split(members),
      },
    ],
    source: "manual" as const,
    status: overrides.status ?? ("confirmed" as const),
  });
}

// ==========================================================================
// 認証: 内部シークレット
// ==========================================================================

describe("認証: 内部シークレット", () => {
  test("現行・PREVIOUSどちらも未設定なら503(server_not_configured)", async () => {
    const t = setup();
    vi.stubEnv("WARIKAPP_MCP_INTERNAL_SECRET", "");
    const { status, body } = await fetchMcp(t, "/mcp/balance", {
      clerkUserId: "alice",
    });
    expect(status).toBe(503);
    expect(body.error.code).toBe("server_not_configured");
  });

  test("シークレット不一致なら401(unauthorized)", async () => {
    const t = setup();
    const { status, body } = await fetchMcp(t, "/mcp/balance", {
      clerkUserId: "alice",
      authorization: "Bearer wrong-secret",
    });
    expect(status).toBe(401);
    expect(body.error.code).toBe("unauthorized");
  });

  test("Authorizationヘッダーが無ければ401", async () => {
    const t = setup();
    const { status, body } = await fetchMcp(t, "/mcp/balance", {
      clerkUserId: "alice",
      authorization: null,
    });
    expect(status).toBe(401);
    expect(body.error.code).toBe("unauthorized");
  });

  test("ローテーション中はPREVIOUSシークレットでも通る", async () => {
    const t = setup();
    await setupCouple(t);
    vi.stubEnv("WARIKAPP_MCP_INTERNAL_SECRET_PREVIOUS", PREVIOUS_SECRET);

    const { status } = await fetchMcp(t, "/mcp/balance", {
      clerkUserId: "alice",
      authorization: `Bearer ${PREVIOUS_SECRET}`,
    });
    expect(status).toBe(200);
  });

  test("PREVIOUSを設定していなければ旧シークレットは401", async () => {
    const t = setup();
    await setupCouple(t);
    // WARIKAPP_MCP_INTERNAL_SECRET_PREVIOUS を設定しない = 削除後の状態と同じ

    const { status, body } = await fetchMcp(t, "/mcp/balance", {
      clerkUserId: "alice",
      authorization: `Bearer ${PREVIOUS_SECRET}`,
    });
    expect(status).toBe(401);
    expect(body.error.code).toBe("unauthorized");
  });
});

// ==========================================================================
// 認可: member解決
// ==========================================================================

describe("認可: member解決", () => {
  test("未知のuserIdは403(forbidden)", async () => {
    const t = setup();
    const { status, body } = await fetchMcp(t, "/mcp/balance", {
      clerkUserId: "nobody-such-user",
    });
    expect(status).toBe(403);
    expect(body.error.code).toBe("forbidden");
  });

  test("X-Warikapp-Clerk-User-Idヘッダーが無ければ403", async () => {
    const t = setup();
    const { status, body } = await fetchMcp(t, "/mcp/balance", {});
    expect(status).toBe(403);
    expect(body.error.code).toBe("forbidden");
  });

  test("世帯未所属のuserIdは403", async () => {
    const t = setup();
    // couples.createCoupleを呼んでいない=世帯未所属のidentityは存在しない状態。
    // ここでは「Convex識別子は存在するが members に行が無い」ケースとして
    // 単に未登録のsubjectをそのまま使う
    const { status, body } = await fetchMcp(t, "/mcp/balance", {
      clerkUserId: "carol",
    });
    expect(status).toBe(403);
    expect(body.error.code).toBe("forbidden");
  });

  test("tokenIdentifierが重複しているとfail closedで403", async () => {
    const t = setup();
    const coupleId = await t.run(async (ctx) =>
      ctx.db.insert("couples", { name: "テスト" }),
    );
    const dupToken = `${ISSUER}|dup`;
    await t.run(async (ctx) => {
      await ctx.db.insert("members", {
        coupleId,
        tokenIdentifier: dupToken,
        displayName: "A",
      });
      await ctx.db.insert("members", {
        coupleId,
        tokenIdentifier: dupToken,
        displayName: "B",
      });
    });

    const { status, body } = await fetchMcp(t, "/mcp/balance", {
      clerkUserId: "dup",
    });
    expect(status).toBe(403);
    expect(body.error.code).toBe("forbidden");
  });
});

// ==========================================================================
// テナント分離
// ==========================================================================

describe("テナント分離", () => {
  test("2世帯を同時投入しても4APIすべてで相手世帯のデータが混ざらない", async () => {
    const t = setup();
    const householdA = await setupCouple(t, ALICE, BOB, "あきこ家", "ぼぶ家");
    const householdB = await setupCouple(t, CAROL, DAVE, "きゃろる家", "でいぶ家");

    const expenseA = await addExpense(t, householdA, ALICE, {
      price: 3000,
      storeName: "A世帯のスーパー",
    });
    const expenseB = await addExpense(t, householdB, CAROL, {
      price: 9000,
      storeName: "B世帯のスーパー",
    });

    // balance: 相手世帯の金額・IDが混入しない
    const balanceA = await fetchMcp(t, "/mcp/balance", { clerkUserId: "alice" });
    expect(balanceA.body.self.member_id).toBe(householdA.self._id);
    expect(balanceA.body.self.display_name).not.toBe(householdB.self.displayName);
    expect(balanceA.body.partner.display_name).toBe("ぼぶ家");

    // expenses: A世帯のIDのみ
    const expensesA = await fetchMcp(t, "/mcp/expenses", { clerkUserId: "alice" });
    const idsA = expensesA.body.expenses.map((e: { id: string }) => e.id);
    expect(idsA).toContain(expenseA);
    expect(idsA).not.toContain(expenseB);
    expect(
      expensesA.body.expenses.every(
        (e: { title: string }) => e.title !== "B世帯のスーパー",
      ),
    ).toBe(true);

    // summary: A世帯の合計のみ
    const month = jstDate().slice(0, 7);
    const summaryA = await fetchMcp(t, `/mcp/summary?month=${month}`, {
      clerkUserId: "alice",
    });
    expect(summaryA.body.total_amount).toBe(3000);
    expect(
      summaryA.body.members.every(
        (m: { display_name: string }) =>
          m.display_name !== "きゃろる家" && m.display_name !== "でいぶ家",
      ),
    ).toBe(true);

    // expense detail: 相手世帯の支出IDは404
    const crossHouseholdDetail = await fetchMcp(
      t,
      `/mcp/expense?id=${expenseB}`,
      { clerkUserId: "alice" },
    );
    expect(crossHouseholdDetail.status).toBe(404);

    // 逆方向(B世帯からAを見ても混ざらない)も確認する
    const balanceB = await fetchMcp(t, "/mcp/balance", { clerkUserId: "carol" });
    expect(balanceB.body.self.member_id).toBe(householdB.self._id);
    expect(balanceB.body.partner.display_name).toBe("でいぶ家");
  });

  test("異なる2ユーザーからのPromise.all並行呼び出しでもコンテキストが混ざらない", async () => {
    const t = setup();
    const householdA = await setupCouple(t, ALICE, BOB, "あきこ家", "ぼぶ家");
    const householdB = await setupCouple(t, CAROL, DAVE, "きゃろる家", "でいぶ家");
    await addExpense(t, householdA, ALICE, { price: 1000 });
    await addExpense(t, householdB, CAROL, { price: 7000 });

    const [resultA, resultB] = await Promise.all([
      fetchMcp(t, "/mcp/balance", { clerkUserId: "alice" }),
      fetchMcp(t, "/mcp/balance", { clerkUserId: "carol" }),
    ]);

    expect(resultA.body.self.member_id).toBe(householdA.self._id);
    expect(resultA.body.self.display_name).toBe("あきこ家");
    expect(resultA.body.paid_by_self).toBe(1000);

    expect(resultB.body.self.member_id).toBe(householdB.self._id);
    expect(resultB.body.self.display_name).toBe("きゃろる家");
    expect(resultB.body.paid_by_self).toBe(7000);
  });
});

// ==========================================================================
// GET /mcp/balance
// ==========================================================================

describe("GET /mcp/balance", () => {
  test("既存settlements.currentBalanceと同じ結果になる(方向・金額)", async () => {
    const t = setup();
    const members = await setupCouple(t);
    await addExpense(t, members, ALICE, { price: 5000 });
    await addExpense(t, members, BOB, { paidBy: members.partner._id, price: 2000 });

    const { body } = await fetchMcp(t, "/mcp/balance", { clerkUserId: "alice" });
    const reference = await t
      .withIdentity(ALICE)
      .query(api.settlements.currentBalance, {});

    expect(body.currency).toBe("JPY");
    expect(body.amount).toBe(reference.amount);
    expect(body.amount).toBe(1500);
    expect(body.direction).toBe("partner_pays_self");
    expect(body.paid_by_self).toBe(reference.paidBySelf);
    expect(body.paid_by_partner).toBe(reference.paidByPartner);
    expect(body.included_expense_count).toBe(reference.expenseCount);
    expect(body.draft_count).toBe(reference.draftCount);
    expect(body.self.member_id).toBe(members.self._id);
    expect(body.partner.member_id).toBe(members.partner._id);
  });

  test("向きが逆なら self_pays_partner", async () => {
    const t = setup();
    const members = await setupCouple(t);
    // パートナーが支払う側になると、自分が立て替えを受ける側=支払う側になる
    await addExpense(t, members, BOB, { paidBy: members.partner._id, price: 5000 });

    const { body } = await fetchMcp(t, "/mcp/balance", { clerkUserId: "alice" });
    expect(body.direction).toBe("self_pays_partner");
  });

  test("ドラフトは差額に含めず件数だけ返す", async () => {
    const t = setup();
    const members = await setupCouple(t);
    await addExpense(t, members, ALICE, { price: 5000, status: "draft" });

    const { body } = await fetchMcp(t, "/mcp/balance", { clerkUserId: "alice" });
    expect(body.amount).toBe(0);
    expect(body.included_expense_count).toBe(0);
    expect(body.draft_count).toBe(1);
  });

  test("パートナー未参加ならpartner:null・direction:even・amount:0", async () => {
    const t = setup();
    await t.withIdentity(ALICE).mutation(api.couples.createCouple, {
      displayName: "ひとり",
    });

    const { body } = await fetchMcp(t, "/mcp/balance", { clerkUserId: "alice" });
    expect(body.partner).toBeNull();
    expect(body.direction).toBe("even");
    expect(body.amount).toBe(0);
  });

  test("差額0でもdirectionはeven", async () => {
    const t = setup();
    const members = await setupCouple(t);
    await addExpense(t, members, ALICE, { price: 4000 });
    await addExpense(t, members, BOB, { paidBy: members.partner._id, price: 4000 });

    const { body } = await fetchMcp(t, "/mcp/balance", { clerkUserId: "alice" });
    expect(body.amount).toBe(0);
    expect(body.direction).toBe("even");
  });

  test("上限超過時はtruncated:trueでincluded_expense_countが部分集計件数になる", async () => {
    const t = setup();
    const members = await setupCouple(t);
    const coupleId = await t.run(async (ctx) => {
      const self = await ctx.db.get("members", members.self._id);
      for (let i = 0; i < 201; i++) {
        await ctx.db.insert("expenses", {
          coupleId: self!.coupleId,
          paidBy: members.self._id,
          purchasedAt: `2026-01-${String((i % 28) + 1).padStart(2, "0")}`,
          totalAmount: 1000,
          items: [
            { name: "食材", price: 1000, quantity: 1, shares: split(members) },
          ],
          source: "manual",
          status: "confirmed",
        });
      }
      return self!.coupleId;
    });

    const { body } = await fetchMcp(t, "/mcp/balance", { clerkUserId: "alice" });
    expect(body.truncated).toBe(true);
    expect(body.included_expense_count).toBe(200);
    expect(body.amount).toBe(200 * 500);
    expect(coupleId).toBeDefined();
  });
});

// ==========================================================================
// GET /mcp/expenses
// ==========================================================================

describe("GET /mcp/expenses", () => {
  test("filter=unsettledが既定で、精算済みは出ない", async () => {
    const t = setup();
    const members = await setupCouple(t);
    await addExpense(t, members, ALICE, { price: 5000 });
    await t.withIdentity(ALICE).mutation(api.settlements.execute, {
      memo: undefined,
      expectedAmount: 2500,
      expectedFromMemberId: members.partner._id,
      expectedExpenseCount: 1,
    });
    const unsettled = await addExpense(t, members, ALICE, { price: 1000 });

    const { body } = await fetchMcp(t, "/mcp/expenses", { clerkUserId: "alice" });
    expect(body.expenses).toHaveLength(1);
    expect(body.expenses[0].id).toBe(unsettled);
    expect(body.expenses[0].settled).toBe(false);
  });

  test("filter=allなら精算済み・未精算どちらも出る(論理削除は除外)", async () => {
    const t = setup();
    const members = await setupCouple(t);
    const removed = await addExpense(t, members, ALICE, { price: 1000 });
    await addExpense(t, members, ALICE, { price: 2000 });
    await t.withIdentity(ALICE).mutation(api.expenses.remove, {
      expenseId: removed,
    });

    const { body } = await fetchMcp(t, "/mcp/expenses?filter=all", {
      clerkUserId: "alice",
    });
    const ids = body.expenses.map((e: { id: string }) => e.id);
    expect(ids).not.toContain(removed);
    expect(body.expenses).toHaveLength(1);
  });

  test("date_from/date_toで購入日を絞り込む(境界日を含み、隣接日は含まない)", async () => {
    const t = setup();
    const members = await setupCouple(t);
    await addExpense(t, members, ALICE, {
      price: 1000,
      itemName: "3日前",
      purchasedAt: jstDate(-3),
    });
    const middle = await addExpense(t, members, ALICE, {
      price: 2000,
      itemName: "2日前",
      purchasedAt: jstDate(-2),
    });
    await addExpense(t, members, ALICE, {
      price: 3000,
      itemName: "1日前",
      purchasedAt: jstDate(-1),
    });

    const { body } = await fetchMcp(
      t,
      `/mcp/expenses?filter=all&date_from=${jstDate(-2)}&date_to=${jstDate(-2)}`,
      { clerkUserId: "alice" },
    );
    expect(body.expenses).toHaveLength(1);
    expect(body.expenses[0].id).toBe(middle);
    expect(body.expenses[0].total_amount).toBe(2000);
  });

  test("ページング往復で全件が漏れなく一度ずつ列挙され、最終ページはnext_cursor:null", async () => {
    const t = setup();
    const members = await setupCouple(t);
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      ids.push(
        await addExpense(t, members, ALICE, {
          price: 1000 + i,
          purchasedAt: jstDate(-i),
        }),
      );
    }

    const seen: string[] = [];
    let cursor: string | null = null;
    let hasMore = true;
    let guard = 0;
    while (hasMore) {
      guard += 1;
      if (guard > 10) {
        throw new Error("ページングが終わらない");
      }
      const path: string =
        cursor === null
          ? "/mcp/expenses?limit=2"
          : `/mcp/expenses?limit=2&cursor=${encodeURIComponent(cursor)}`;
      const { body } = await fetchMcp(t, path, { clerkUserId: "alice" });
      for (const expense of body.expenses as { id: string }[]) {
        seen.push(expense.id);
      }
      hasMore = body.has_more;
      cursor = body.next_cursor;
      if (!hasMore) {
        expect(body.next_cursor).toBeNull();
      }
    }

    expect(seen.sort()).toEqual([...ids].sort());
    expect(new Set(seen).size).toBe(ids.length);
  });

  test("cursorの条件(filter)が現リクエストと不一致なら400", async () => {
    const t = setup();
    const members = await setupCouple(t);
    for (let i = 0; i < 3; i++) {
      await addExpense(t, members, ALICE, { price: 1000, purchasedAt: jstDate(-i) });
    }

    const first = await fetchMcp(t, "/mcp/expenses?filter=unsettled&limit=1", {
      clerkUserId: "alice",
    });
    expect(first.body.has_more).toBe(true);
    const cursor = first.body.next_cursor as string;

    const mismatched = await fetchMcp(
      t,
      `/mcp/expenses?filter=all&limit=1&cursor=${encodeURIComponent(cursor)}`,
      { clerkUserId: "alice" },
    );
    expect(mismatched.status).toBe(400);
    expect(mismatched.body.error.code).toBe("invalid_request");
  });

  test("世帯Aで取得したnext_cursorを世帯Bのユーザーが使うと400(テナント分離の多層防御)", async () => {
    const t = setup();
    const householdA = await setupCouple(t, ALICE, BOB, "あきこ家", "ぼぶ家");
    await setupCouple(t, CAROL, DAVE, "きゃろる家", "でいぶ家");
    for (let i = 0; i < 3; i++) {
      await addExpense(t, householdA, ALICE, { price: 1000, purchasedAt: jstDate(-i) });
    }

    const firstPage = await fetchMcp(t, "/mcp/expenses?limit=1", {
      clerkUserId: "alice",
    });
    expect(firstPage.body.has_more).toBe(true);
    const cursorFromHouseholdA = firstPage.body.next_cursor as string;

    const usedByHouseholdB = await fetchMcp(
      t,
      `/mcp/expenses?limit=1&cursor=${encodeURIComponent(cursorFromHouseholdA)}`,
      { clerkUserId: "carol" },
    );
    expect(usedByHouseholdB.status).toBe(400);
    expect(usedByHouseholdB.body.error.code).toBe("invalid_request");
  });

  test("復号できないcursorは400", async () => {
    const t = setup();
    await setupCouple(t);
    const { status, body } = await fetchMcp(t, "/mcp/expenses?cursor=not-a-valid-cursor!!", {
      clerkUserId: "alice",
    });
    expect(status).toBe(400);
    expect(body.error.code).toBe("invalid_request");
  });

  test("filterが不正なら400", async () => {
    const t = setup();
    await setupCouple(t);
    const { status, body } = await fetchMcp(t, "/mcp/expenses?filter=nope", {
      clerkUserId: "alice",
    });
    expect(status).toBe(400);
    expect(body.error.code).toBe("invalid_request");
  });

  test("limitが範囲外なら400", async () => {
    const t = setup();
    await setupCouple(t);
    const tooLarge = await fetchMcp(t, "/mcp/expenses?limit=51", {
      clerkUserId: "alice",
    });
    expect(tooLarge.status).toBe(400);
    const zero = await fetchMcp(t, "/mcp/expenses?limit=0", {
      clerkUserId: "alice",
    });
    expect(zero.status).toBe(400);
  });

  test("実在しない日付(2026-02-31)は400", async () => {
    const t = setup();
    await setupCouple(t);
    const { status, body } = await fetchMcp(
      t,
      "/mcp/expenses?date_from=2026-02-31",
      { clerkUserId: "alice" },
    );
    expect(status).toBe(400);
    expect(body.error.code).toBe("invalid_request");
  });

  test("date_from > date_toは400", async () => {
    const t = setup();
    await setupCouple(t);
    const { status } = await fetchMcp(
      t,
      `/mcp/expenses?date_from=${jstDate()}&date_to=${jstDate(-1)}`,
      { clerkUserId: "alice" },
    );
    expect(status).toBe(400);
  });
});

// ==========================================================================
// cursorエンベロープの署名検証(レビュー指摘 中2)
// ==========================================================================

describe("cursorエンベロープの署名検証", () => {
  test("署名(.以降)が無いcursorは400", async () => {
    const t = setup();
    await setupCouple(t);

    // "."区切りが無い、旧形式相当(base64urlペイロードのみ)のcursor
    const unsignedPayload = base64UrlEncodeJson({
      v: 1,
      filter: "unsettled",
      date_from: null,
      date_to: null,
      c: "dummy",
      convex_cursor: "dummy",
    });

    const { status, body } = await fetchMcp(
      t,
      `/mcp/expenses?cursor=${encodeURIComponent(unsignedPayload)}`,
      { clerkUserId: "alice" },
    );
    expect(status).toBe(400);
    expect(body.error.code).toBe("invalid_request");
  });

  test("正規に発行されたcursorのconvex_cursorだけ書き換えると署名不一致で400", async () => {
    const t = setup();
    const members = await setupCouple(t);
    for (let i = 0; i < 3; i++) {
      await addExpense(t, members, ALICE, { price: 1000, purchasedAt: jstDate(-i) });
    }

    const first = await fetchMcp(t, "/mcp/expenses?limit=1", { clerkUserId: "alice" });
    expect(first.body.has_more).toBe(true);
    const issued = first.body.next_cursor as string;
    const dotIndex = issued.indexOf(".");
    const [payloadB64, originalSignature] = [
      issued.slice(0, dotIndex),
      issued.slice(dotIndex + 1),
    ];
    const envelope = base64UrlDecodeJson(payloadB64);

    // convex_cursorだけ書き換え、署名は元のまま使い回す
    // (=秘密鍵を持たない攻撃者がやること)
    const tamperedPayload = base64UrlEncodeJson({
      ...envelope,
      convex_cursor: "tampered-value",
    });
    const tampered = `${tamperedPayload}.${originalSignature}`;

    const { status, body } = await fetchMcp(
      t,
      `/mcp/expenses?limit=1&cursor=${encodeURIComponent(tampered)}`,
      { clerkUserId: "alice" },
    );
    expect(status).toBe(400);
    expect(body.error.code).toBe("invalid_request");
  });

  test("正規に署名されたエンベロープでもconvex_cursor自体が無効なら400(500にならない)", async () => {
    const t = setup();
    const members = await setupCouple(t);
    const coupleId = await t.run(async (ctx) => {
      const self = await ctx.db.get("members", members.self._id);
      return self!.coupleId;
    });

    // encodeCursorは本物(http.ts)を直接呼ぶ。署名は正規(テスト環境の
    // WARIKAPP_MCP_INTERNAL_SECRETと同じ鍵)だが、convex_cursorの中身だけ
    // .paginate()が受け付けない値にしてある
    const forged = await encodeCursor({
      v: 1,
      filter: "unsettled",
      date_from: null,
      date_to: null,
      c: coupleId,
      convex_cursor: "not-a-real-convex-cursor",
    });

    const { status, body } = await fetchMcp(
      t,
      `/mcp/expenses?cursor=${encodeURIComponent(forged)}`,
      { clerkUserId: "alice" },
    );
    expect(status).toBe(400);
    expect(body.error.code).toBe("invalid_request");
  });
});

// ==========================================================================
// GET /mcp/summary
// ==========================================================================

describe("GET /mcp/summary", () => {
  test("monthが無ければ400", async () => {
    const t = setup();
    await setupCouple(t);
    const { status, body } = await fetchMcp(t, "/mcp/summary", {
      clerkUserId: "alice",
    });
    expect(status).toBe(400);
    expect(body.error.code).toBe("invalid_request");
  });

  test("不正なmonthは400", async () => {
    const t = setup();
    await setupCouple(t);
    const { status } = await fetchMcp(t, "/mcp/summary?month=2026-13", {
      clerkUserId: "alice",
    });
    expect(status).toBe(400);
  });

  // レビュー指摘 軽微1: 正規表現 \d{4} だけでは "0001-01" のような値も通り、
  // convex/mcp.ts の monthDateRange が使う Date.UTC(year, monthIndex, 1) の
  // 「年0〜99は1900〜1999として扱われる」仕様に引っかかって誤った月範囲になる。
  // 2000〜2100年の範囲外は400にする
  test("年が2000〜2100の範囲外のmonthは400(Date.UTCの2桁年問題の回避)", async () => {
    const t = setup();
    await setupCouple(t);
    const { status, body } = await fetchMcp(t, "/mcp/summary?month=0001-01", {
      clerkUserId: "alice",
    });
    expect(status).toBe(400);
    expect(body.error.code).toBe("invalid_request");
  });

  test("メンバー別のpaid/share/unsettled_paid、settled/unsettled内訳、draft_countを返す", async () => {
    const t = setup();
    const members = await setupCouple(t);
    const { thisMonth, thisMonthFirstDay } = monthBoundary();

    // 自分が5,000円折半で支払い、精算済みにする
    const settled = await addExpense(t, members, ALICE, {
      price: 5000,
      purchasedAt: thisMonthFirstDay,
    });
    await t.withIdentity(ALICE).mutation(api.settlements.execute, {
      memo: undefined,
      expectedAmount: 2500,
      expectedFromMemberId: members.partner._id,
      expectedExpenseCount: 1,
    });
    // パートナーが2,000円折半で支払い、未精算のまま
    await addExpense(t, members, BOB, {
      paidBy: members.partner._id,
      price: 2000,
      purchasedAt: thisMonthFirstDay,
    });
    // 未確定(draft)は金額集計に含めない
    await addExpense(t, members, ALICE, {
      price: 999,
      status: "draft",
      purchasedAt: thisMonthFirstDay,
    });

    const { body } = await fetchMcp(t, `/mcp/summary?month=${thisMonth}`, {
      clerkUserId: "alice",
    });

    expect(body.month).toBe(thisMonth);
    expect(body.included_expense_count).toBe(2);
    expect(body.draft_count).toBe(1);
    expect(body.total_amount).toBe(7000);
    expect(body.settled_amount).toBe(5000);
    expect(body.unsettled_amount).toBe(2000);
    // 月内の未精算(confirmed)だけを見ると、パートナーが2,000円を折半で
    // 立て替えている(自分の半分1,000円をパートナーが払った)ので自分が払う側
    expect(body.unsettled_balance).toEqual({
      amount: 1000,
      direction: "self_pays_partner",
    });

    const self = body.members.find((m: { is_self: boolean }) => m.is_self);
    const partner = body.members.find((m: { is_self: boolean }) => !m.is_self);
    expect(self.paid_amount).toBe(5000);
    expect(self.share_amount).toBe(3500); // 5,000円の半分 + 2,000円の半分
    expect(self.unsettled_paid_amount).toBe(0); // 支払った5,000円は精算済み
    expect(partner.paid_amount).toBe(2000);
    expect(partner.share_amount).toBe(3500);
    expect(partner.unsettled_paid_amount).toBe(2000);
    expect(settled).toBeDefined();
  });

  test("先月の支出は当月サマリーに含まれない(月境界)", async () => {
    const t = setup();
    const members = await setupCouple(t);
    const { thisMonth, thisMonthFirstDay, prevMonthLastDay } = monthBoundary();

    await addExpense(t, members, ALICE, {
      price: 4000,
      purchasedAt: prevMonthLastDay,
    });
    await addExpense(t, members, ALICE, {
      price: 1000,
      purchasedAt: thisMonthFirstDay,
    });

    const { body } = await fetchMcp(t, `/mcp/summary?month=${thisMonth}`, {
      clerkUserId: "alice",
    });
    expect(body.included_expense_count).toBe(1);
    expect(body.total_amount).toBe(1000);
  });

  test("削除済み支出は範囲除外される", async () => {
    const t = setup();
    const members = await setupCouple(t);
    const { thisMonth, thisMonthFirstDay } = monthBoundary();
    const removed = await addExpense(t, members, ALICE, {
      price: 8000,
      purchasedAt: thisMonthFirstDay,
    });
    await t.withIdentity(ALICE).mutation(api.expenses.remove, {
      expenseId: removed,
    });

    const { body } = await fetchMcp(t, `/mcp/summary?month=${thisMonth}`, {
      clerkUserId: "alice",
    });
    expect(body.included_expense_count).toBe(0);
    expect(body.total_amount).toBe(0);
  });
});

// ==========================================================================
// GET /mcp/expense
// ==========================================================================

describe("GET /mcp/expense", () => {
  test("品目内訳・負担額(丸め込み)を返し、Web側の計算と一致する", async () => {
    const t = setup();
    const members = await setupCouple(t);
    const expenseId = await t.withIdentity(ALICE).mutation(api.expenses.save, {
      paidBy: members.self._id,
      storeName: "オーケー",
      purchasedAt: jstDate(),
      items: [
        {
          name: "牛乳",
          price: 999,
          quantity: 1,
          shares: [
            { memberId: members.self._id, ratioPercent: 33 },
            { memberId: members.partner._id, ratioPercent: 67 },
          ],
        },
      ],
      source: "manual",
      status: "confirmed",
    });

    const { body } = await fetchMcp(t, `/mcp/expense?id=${expenseId}`, {
      clerkUserId: "alice",
    });

    expect(body.store_name).toBe("オーケー");
    expect(body.total_amount).toBe(999);
    expect(body.settled).toBe(false);
    expect(body.items).toHaveLength(1);
    const item = body.items[0];
    expect(item.subtotal).toBe(999);
    const selfShare = item.shares.find(
      (s: { member_id: string }) => s.member_id === members.self._id,
    );
    const partnerShare = item.shares.find(
      (s: { member_id: string }) => s.member_id === members.partner._id,
    );
    // 999 * 33% = 329.67 → 四捨五入で330円、67%側は669円(端数は品目ごとの独立丸め)
    expect(selfShare.amount).toBe(330);
    expect(partnerShare.amount).toBe(669);
    // 支払者本人以外の負担分の合計が advance_amount と一致する(=立て替え額)
    expect(body.advance_amount).toBe(partnerShare.amount);
  });

  test("店名が無ければstore_name:null", async () => {
    const t = setup();
    const members = await setupCouple(t);
    const expenseId = await addExpense(t, members, ALICE, {});

    const { body } = await fetchMcp(t, `/mcp/expense?id=${expenseId}`, {
      clerkUserId: "alice",
    });
    expect(body.store_name).toBeNull();
  });

  test("不正な形式のIDは404", async () => {
    const t = setup();
    await setupCouple(t);
    const { status, body } = await fetchMcp(t, "/mcp/expense?id=not-a-real-id", {
      clerkUserId: "alice",
    });
    expect(status).toBe(404);
    expect(body.error.code).toBe("not_found");
  });

  test("idパラメータが無ければ404", async () => {
    const t = setup();
    await setupCouple(t);
    const { status } = await fetchMcp(t, "/mcp/expense", { clerkUserId: "alice" });
    expect(status).toBe(404);
  });

  test("他世帯の支出IDは404", async () => {
    const t = setup();
    const members = await setupCouple(t);
    const other = await setupCouple(t, CAROL, DAVE, "きゃろる家", "でいぶ家");
    const otherExpenseId = await addExpense(t, other, CAROL, { price: 3000 });

    const { status } = await fetchMcp(
      t,
      `/mcp/expense?id=${otherExpenseId}`,
      { clerkUserId: "alice" },
    );
    expect(status).toBe(404);
    expect(members.self).toBeDefined();
  });

  test("論理削除済みの支出は404", async () => {
    const t = setup();
    const members = await setupCouple(t);
    const expenseId = await addExpense(t, members, ALICE, { price: 1000 });
    await t.withIdentity(ALICE).mutation(api.expenses.remove, { expenseId });

    const { status } = await fetchMcp(t, `/mcp/expense?id=${expenseId}`, {
      clerkUserId: "alice",
    });
    expect(status).toBe(404);
  });
});

// ==========================================================================
// レートリミット
// ==========================================================================

describe("レートリミット", () => {
  test("capacity(20)を超えると429 + retry_after_secondsを返す", async () => {
    const t = setup();
    await t.withIdentity(ALICE).mutation(api.couples.createCouple, {
      displayName: "ひとり",
    });

    for (let i = 0; i < 20; i++) {
      const { status } = await fetchMcp(t, "/mcp/balance", {
        clerkUserId: "alice",
      });
      expect(status).toBe(200);
    }

    const { status, body } = await fetchMcp(t, "/mcp/balance", {
      clerkUserId: "alice",
    });
    expect(status).toBe(429);
    expect(body.error.code).toBe("rate_limited");
    expect(body.retry_after_seconds).toBeGreaterThan(0);
  });

  test("member単位なので、別メンバーの呼び出しは巻き込まれない", async () => {
    const t = setup();
    const members = await setupCouple(t);

    for (let i = 0; i < 20; i++) {
      const { status } = await fetchMcp(t, "/mcp/balance", {
        clerkUserId: "alice",
      });
      expect(status).toBe(200);
    }
    // aliceは枠を使い切ったが、bobは別キーなので通る
    const { status } = await fetchMcp(t, "/mcp/balance", {
      clerkUserId: "bob",
    });
    expect(status).toBe(200);
    expect(members.partner).toBeDefined();
  });
});

// 本番ランタイムはメッセージに "InvalidCursor" を含まない、構造化データのみの
// ConvexError で投げることがある(convex公式 use_paginated_query.ts と同じ形)。
// 4巡目レビュー指摘: この形を取りこぼすと 400 ではなく 500 に抜ける。
describe("isInvalidCursorError", () => {
  test("構造化ConvexError(isConvexSystemError + paginationError)を判定できる", () => {
    const error = new ConvexError({
      isConvexSystemError: true,
      paginationError: "InvalidCursor",
    });
    expect(isInvalidCursorError(error)).toBe(true);
  });

  test("無関係な構造化ConvexErrorは判定しない", () => {
    expect(isInvalidCursorError(new ConvexError({ foo: "bar" }))).toBe(false);
    expect(isInvalidCursorError(new Error("なにか別のエラー"))).toBe(false);
    expect(isInvalidCursorError("string error")).toBe(false);
  });

  test("メッセージベースの従来判定も維持される", () => {
    expect(isInvalidCursorError(new Error("InvalidCursor: bad"))).toBe(true);
  });
});
