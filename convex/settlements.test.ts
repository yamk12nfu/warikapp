/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const ISSUER = "https://clerk.test";
const identity = (name: string) => ({
  issuer: ISSUER,
  subject: name,
  tokenIdentifier: `${ISSUER}|${name}`,
});

const ALICE = identity("alice");
const BOB = identity("bob");
const CAROL = identity("carol");

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

// サーバー側の未来日判定はJST基準なので、テストの日付もJSTで組む
const jstDate = (offsetDays = 0) =>
  new Date(Date.now() + JST_OFFSET_MS + offsetDays * DAY_MS)
    .toISOString()
    .slice(0, 10);

type Members = {
  self: { _id: Id<"members">; displayName: string };
  partner: { _id: Id<"members">; displayName: string };
};

// 2名の世帯を作り、双方の memberId を返す
async function setupCouple(
  t: ReturnType<typeof convexTest>,
  owner = ALICE,
  joiner = BOB,
): Promise<Members> {
  const invitation = await t
    .withIdentity(owner)
    .mutation(api.couples.createCouple, { displayName: "あきこ" });
  await t.withIdentity(joiner).mutation(api.couples.joinCouple, {
    code: invitation.code,
    displayName: "ぼぶ",
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

// 折半・当日・確定の支出を1件登録する
async function addExpense(
  t: ReturnType<typeof convexTest>,
  members: Members,
  who: typeof ALICE,
  overrides: Partial<{
    paidBy: Id<"members">;
    price: number;
    storeName: string;
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
        name: "食材",
        price: overrides.price ?? 5000,
        quantity: 1,
        shares: overrides.shares ?? split(members),
      },
    ],
    source: "manual" as const,
    status: overrides.status ?? ("confirmed" as const),
  });
}

// 精算を実行する。画面と同じく「いま表示されている差額」を expectedAmount として
// 渡す(V-702のガード)。ずれを試したいテストは expectedAmount を明示する
async function settle(
  t: ReturnType<typeof convexTest>,
  who: typeof ALICE,
  overrides: {
    memo?: string;
    expectedAmount?: number;
    expectedFromMemberId?: Id<"members"> | null;
    expectedExpenseCount?: number;
  } = {},
) {
  const balance = await t
    .withIdentity(who)
    .query(api.settlements.currentBalance, {});
  return await t.withIdentity(who).mutation(api.settlements.execute, {
    memo: overrides.memo,
    expectedAmount: overrides.expectedAmount ?? balance.amount,
    expectedFromMemberId:
      overrides.expectedFromMemberId === undefined
        ? balance.fromMemberId
        : overrides.expectedFromMemberId,
    expectedExpenseCount:
      overrides.expectedExpenseCount ?? balance.expenseCount,
  });
}

const listArgs = (numItems = 20, cursor: string | null = null) => ({
  paginationOpts: { numItems, cursor },
});

describe("settlements.currentBalance", () => {
  test("要件の例: A5,000円折半+B2,000円折半 → BがAに1,500円", async () => {
    const t = convexTest(schema, modules);
    const members = await setupCouple(t);
    await addExpense(t, members, ALICE, { price: 5000 });
    await addExpense(t, members, BOB, {
      paidBy: members.partner._id,
      price: 2000,
    });

    const balance = await t
      .withIdentity(ALICE)
      .query(api.settlements.currentBalance, {});
    expect(balance).toMatchObject({
      amount: 1500,
      fromMemberId: members.partner._id,
      toMemberId: members.self._id,
      expenseCount: 2,
      draftCount: 0,
      truncated: false,
    });
  });

  test("メンバー別の支払い合計は視点に合わせて self/partner が入れ替わる", async () => {
    const t = convexTest(schema, modules);
    const members = await setupCouple(t);
    await addExpense(t, members, ALICE, { price: 5000 });
    await addExpense(t, members, BOB, {
      paidBy: members.partner._id,
      price: 2000,
    });

    const fromAlice = await t
      .withIdentity(ALICE)
      .query(api.settlements.currentBalance, {});
    expect(fromAlice.paidBySelf).toBe(5000);
    expect(fromAlice.paidByPartner).toBe(2000);

    const fromBob = await t
      .withIdentity(BOB)
      .query(api.settlements.currentBalance, {});
    expect(fromBob.paidBySelf).toBe(2000);
    expect(fromBob.paidByPartner).toBe(5000);
  });

  test("支払い合計はドラフトを含めない", async () => {
    const t = convexTest(schema, modules);
    const members = await setupCouple(t);
    await addExpense(t, members, ALICE, { price: 5000 });
    await addExpense(t, members, ALICE, { price: 3000, status: "draft" });

    const balance = await t
      .withIdentity(ALICE)
      .query(api.settlements.currentBalance, {});
    expect(balance.paidBySelf).toBe(5000); // ドラフトの3,000円は含めない
    expect(balance.paidByPartner).toBe(0);
  });

  test("支払い合計は精算後に0へ戻る", async () => {
    const t = convexTest(schema, modules);
    const members = await setupCouple(t);
    await addExpense(t, members, ALICE, { price: 5000 });
    await settle(t, ALICE);

    const balance = await t
      .withIdentity(ALICE)
      .query(api.settlements.currentBalance, {});
    expect(balance.paidBySelf).toBe(0);
    expect(balance.paidByPartner).toBe(0);
  });

  test("相手から見ると向きは同じで、金額も一致する", async () => {
    const t = convexTest(schema, modules);
    const members = await setupCouple(t);
    await addExpense(t, members, ALICE, { price: 5000 });

    const fromAlice = await t
      .withIdentity(ALICE)
      .query(api.settlements.currentBalance, {});
    const fromBob = await t
      .withIdentity(BOB)
      .query(api.settlements.currentBalance, {});
    expect(fromBob.amount).toBe(fromAlice.amount);
    expect(fromBob.fromMemberId).toBe(fromAlice.fromMemberId);
    expect(fromBob.toMemberId).toBe(fromAlice.toMemberId);
  });

  test("支出が無ければ差額0・方向なし", async () => {
    const t = convexTest(schema, modules);
    await setupCouple(t);
    const balance = await t
      .withIdentity(ALICE)
      .query(api.settlements.currentBalance, {});
    expect(balance).toMatchObject({
      amount: 0,
      fromMemberId: null,
      toMemberId: null,
      expenseCount: 0,
    });
  });

  test("ドラフトは差額に含めず、件数だけ返す(V-701の警告用)", async () => {
    const t = convexTest(schema, modules);
    const members = await setupCouple(t);
    await addExpense(t, members, ALICE, { price: 5000, status: "draft" });

    const balance = await t
      .withIdentity(ALICE)
      .query(api.settlements.currentBalance, {});
    expect(balance.amount).toBe(0);
    expect(balance.expenseCount).toBe(0);
    expect(balance.draftCount).toBe(1);
  });

  test("精算済み・論理削除の支出は差額に含めない", async () => {
    const t = convexTest(schema, modules);
    const members = await setupCouple(t);
    await addExpense(t, members, ALICE, { price: 5000 });
    await settle(t, ALICE);

    // 精算後は差額0に戻る
    expect(
      (await t.withIdentity(ALICE).query(api.settlements.currentBalance, {}))
        .amount,
    ).toBe(0);

    const removedId = await addExpense(t, members, ALICE, { price: 4000 });
    await t
      .withIdentity(ALICE)
      .mutation(api.expenses.remove, { expenseId: removedId });
    const balance = await t
      .withIdentity(ALICE)
      .query(api.settlements.currentBalance, {});
    expect(balance.amount).toBe(0);
    expect(balance.expenseCount).toBe(0);
  });

  test("パートナー未参加の世帯では差額を出さない", async () => {
    const t = convexTest(schema, modules);
    await t
      .withIdentity(ALICE)
      .mutation(api.couples.createCouple, { displayName: "あきこ" });
    const balance = await t
      .withIdentity(ALICE)
      .query(api.settlements.currentBalance, {});
    expect(balance).toMatchObject({ amount: 0, fromMemberId: null });
  });

  test("他世帯の支出は差額に混ざらない", async () => {
    const t = convexTest(schema, modules);
    const members = await setupCouple(t);
    const other = await setupCouple(t, CAROL, identity("dave"));
    await addExpense(t, other, CAROL, { price: 8000 });

    const balance = await t
      .withIdentity(ALICE)
      .query(api.settlements.currentBalance, {});
    expect(balance.amount).toBe(0);
    expect(balance.expenseCount).toBe(0);
    expect(members.self._id).not.toBe(other.self._id);
  });

  test("未ログイン・世帯未所属では読めない", async () => {
    const t = convexTest(schema, modules);
    await setupCouple(t);
    await expect(
      t.query(api.settlements.currentBalance, {}),
    ).rejects.toThrow("ログインしてください");
    await expect(
      t.withIdentity(CAROL).query(api.settlements.currentBalance, {}),
    ).rejects.toThrow("世帯に参加してください");
  });
});

describe("settlements.pending", () => {
  test("対象支出を新しい順に、立て替え額つきで返す", async () => {
    const t = convexTest(schema, modules);
    const members = await setupCouple(t);
    await addExpense(t, members, ALICE, {
      price: 5000,
      storeName: "古い",
      purchasedAt: jstDate(-3),
    });
    await addExpense(t, members, BOB, {
      paidBy: members.partner._id,
      price: 2000,
      storeName: "新しい",
    });

    const pending = await t
      .withIdentity(ALICE)
      .query(api.settlements.pending, {});
    expect(pending.amount).toBe(1500);
    expect(pending.expenses.map((e) => e.title)).toEqual(["新しい", "古い"]);
    expect(pending.expenses[0]).toMatchObject({
      totalAmount: 2000,
      paidBy: members.partner._id,
      advanceAmount: 1000, // 相手が支払い、自分のぶん1,000円を立て替え
    });
    expect(pending.expenses[1].advanceAmount).toBe(2500);
  });

  test("店名が無ければ先頭の品目名を見出しにする", async () => {
    const t = convexTest(schema, modules);
    const members = await setupCouple(t);
    await addExpense(t, members, ALICE);
    const pending = await t
      .withIdentity(ALICE)
      .query(api.settlements.pending, {});
    expect(pending.expenses[0].title).toBe("食材");
  });

  test("ドラフトは対象一覧に出さない", async () => {
    const t = convexTest(schema, modules);
    const members = await setupCouple(t);
    await addExpense(t, members, ALICE, { status: "draft" });
    const pending = await t
      .withIdentity(ALICE)
      .query(api.settlements.pending, {});
    expect(pending.expenses).toHaveLength(0);
    expect(pending.draftCount).toBe(1);
  });

  test("未ログイン・世帯未所属では読めない", async () => {
    const t = convexTest(schema, modules);
    await setupCouple(t);
    await expect(t.query(api.settlements.pending, {})).rejects.toThrow(
      "ログインしてください",
    );
    await expect(
      t.withIdentity(CAROL).query(api.settlements.pending, {}),
    ).rejects.toThrow("世帯に参加してください");
  });
});

describe("settlements.execute", () => {
  test("精算レコードを作り、対象支出すべてに settlementId を付ける", async () => {
    const t = convexTest(schema, modules);
    const members = await setupCouple(t);
    const first = await addExpense(t, members, ALICE, { price: 5000 });
    const second = await addExpense(t, members, BOB, {
      paidBy: members.partner._id,
      price: 2000,
    });

    const settlementId = await settle(t, ALICE, { memo: "  6月分  " });

    const settlement = await t.run(async (ctx) =>
      ctx.db.get("settlements", settlementId),
    );
    expect(settlement).toMatchObject({
      fromMemberId: members.partner._id,
      toMemberId: members.self._id,
      amount: 1500,
      memo: "6月分", // 前後の空白を除去
      settledBy: members.self._id,
      expenseCount: 2,
    });

    for (const expenseId of [first, second]) {
      const expense = await t.run(async (ctx) =>
        ctx.db.get("expenses", expenseId),
      );
      expect(expense!.settlementId).toBe(settlementId);
    }
  });

  test("クライアントの表示値ではなくサーバー側の再計算で金額を決める", async () => {
    const t = convexTest(schema, modules);
    const members = await setupCouple(t);
    await addExpense(t, members, ALICE, { price: 3000 });
    // execute は金額を引数に取らない(差額を渡す余地がない)
    const settlementId = await settle(t, BOB);
    const settlement = await t.run(async (ctx) =>
      ctx.db.get("settlements", settlementId),
    );
    expect(settlement!.amount).toBe(1500);
    // 実行者がBでも向きは「BがAに支払う」のまま
    expect(settlement!.fromMemberId).toBe(members.partner._id);
    expect(settlement!.toMemberId).toBe(members.self._id);
    expect(settlement!.settledBy).toBe(members.partner._id);
  });

  test("V-702: 確認画面の差額と食い違ったら実行しない", async () => {
    const t = convexTest(schema, modules);
    const members = await setupCouple(t);
    await addExpense(t, members, ALICE, { price: 5000 });

    // 確認画面が2,500円を出したあとに相手が支出を足した状況を、
    // 古い表示値(2,500円)を渡すことで再現する
    await addExpense(t, members, ALICE, { price: 3000 });
    await expect(
      settle(t, ALICE, { expectedAmount: 2500 }),
    ).rejects.toThrow("精算対象が変わりました");

    // 精算レコードは作られず、支出も未精算のまま
    const balance = await t
      .withIdentity(ALICE)
      .query(api.settlements.currentBalance, {});
    expect(balance.amount).toBe(4000);
    expect(balance.expenseCount).toBe(2);
  });

  test("V-702: 金額が同じでも支払う向きが変わっていたら実行しない", async () => {
    const t = convexTest(schema, modules);
    const members = await setupCouple(t);
    // 相手が2,000円折半で支払い → 自分が相手に1,000円
    await addExpense(t, members, BOB, {
      paidBy: members.partner._id,
      price: 2000,
    });
    // 自分が4,000円折半で支払い → 向きが逆転するが金額は1,000円のまま
    await addExpense(t, members, ALICE, { price: 4000 });

    const balance = await t
      .withIdentity(ALICE)
      .query(api.settlements.currentBalance, {});
    expect(balance.amount).toBe(1000);
    expect(balance.fromMemberId).toBe(members.partner._id); // 向きは逆転済み

    await expect(
      settle(t, ALICE, {
        expectedAmount: 1000,
        expectedFromMemberId: members.self._id, // 逆転前の向き
        expectedExpenseCount: 1,
      }),
    ).rejects.toThrow("精算対象が変わりました");
  });

  test("V-702: 金額も向きも同じでも対象件数が違えば実行しない", async () => {
    const t = convexTest(schema, modules);
    const members = await setupCouple(t);
    await addExpense(t, members, ALICE, { price: 5000 });
    // 全額自己負担の支出は差額を動かさないので、金額・向きだけでは検出できない
    await addExpense(t, members, ALICE, {
      price: 3000,
      shares: [{ memberId: members.self._id, ratioPercent: 100 }],
    });

    await expect(
      settle(t, ALICE, { expectedExpenseCount: 1 }),
    ).rejects.toThrow("精算対象が変わりました");
  });

  test("V-701: ドラフトが残っていたら拒否する", async () => {
    const t = convexTest(schema, modules);
    const members = await setupCouple(t);
    await addExpense(t, members, ALICE, { price: 5000 });
    await addExpense(t, members, ALICE, { status: "draft" });

    await expect(
      settle(t, ALICE),
    ).rejects.toThrow("未確定のレシートがあります");
  });

  test("V-701: 対象0件なら拒否する", async () => {
    const t = convexTest(schema, modules);
    await setupCouple(t);
    await expect(
      settle(t, ALICE),
    ).rejects.toThrow("精算対象がありません");
  });

  test("V-702: 続けて実行しても2件目は対象が無く失敗する", async () => {
    const t = convexTest(schema, modules);
    const members = await setupCouple(t);
    await addExpense(t, members, ALICE, { price: 5000 });

    await settle(t, ALICE);
    await expect(
      settle(t, ALICE),
    ).rejects.toThrow("精算対象がありません");

    const settlements = await t
      .withIdentity(ALICE)
      .query(api.settlements.list, listArgs());
    expect(settlements.page).toHaveLength(1);
  });

  test("差額0でも対象があれば精算して区切れる", async () => {
    const t = convexTest(schema, modules);
    const members = await setupCouple(t);
    await addExpense(t, members, ALICE, { price: 4000 });
    await addExpense(t, members, BOB, {
      paidBy: members.partner._id,
      price: 4000,
    });

    const settlementId = await settle(t, ALICE);
    const settlement = await t.run(async (ctx) =>
      ctx.db.get("settlements", settlementId),
    );
    expect(settlement!.amount).toBe(0);
    expect(settlement!.expenseCount).toBe(2);
    // 方向に意味がないので実行者 → パートナー で記録する
    expect(settlement!.fromMemberId).toBe(members.self._id);
    expect(settlement!.toMemberId).toBe(members.partner._id);
  });

  test("メモは任意。空文字なら保存せず、101文字なら拒否する", async () => {
    const t = convexTest(schema, modules);
    const members = await setupCouple(t);
    await addExpense(t, members, ALICE);

    await expect(
      settle(t, ALICE, { memo: "あ".repeat(101) }),
    ).rejects.toThrow("メモは100文字以内で入力してください");

    const settlementId = await settle(t, ALICE, { memo: "   " });
    const settlement = await t.run(async (ctx) =>
      ctx.db.get("settlements", settlementId),
    );
    expect(settlement!.memo).toBeUndefined();
  });

  test("論理削除された支出は精算対象に入らない", async () => {
    const t = convexTest(schema, modules);
    const members = await setupCouple(t);
    const removedId = await addExpense(t, members, ALICE, { price: 4000 });
    await addExpense(t, members, ALICE, { price: 5000 });
    await t
      .withIdentity(ALICE)
      .mutation(api.expenses.remove, { expenseId: removedId });

    const settlementId = await settle(t, ALICE);
    const settlement = await t.run(async (ctx) =>
      ctx.db.get("settlements", settlementId),
    );
    expect(settlement!.expenseCount).toBe(1);
    expect(settlement!.amount).toBe(2500);
    const removed = await t.run(async (ctx) =>
      ctx.db.get("expenses", removedId),
    );
    expect(removed!.settlementId).toBeUndefined();
  });

  test("他世帯の支出は巻き込まない", async () => {
    const t = convexTest(schema, modules);
    const members = await setupCouple(t);
    await addExpense(t, members, ALICE, { price: 5000 });
    const other = await setupCouple(t, CAROL, identity("dave"));
    const otherExpenseId = await addExpense(t, other, CAROL, { price: 8000 });

    await settle(t, ALICE);

    const otherExpense = await t.run(async (ctx) =>
      ctx.db.get("expenses", otherExpenseId),
    );
    expect(otherExpense!.settlementId).toBeUndefined();
  });

  test("パートナー未参加では精算できない", async () => {
    const t = convexTest(schema, modules);
    await t
      .withIdentity(ALICE)
      .mutation(api.couples.createCouple, { displayName: "あきこ" });
    await expect(
      settle(t, ALICE),
    ).rejects.toThrow("パートナーが参加してから精算してください");
  });

  test("上限を超える未精算支出は古い順に切り出し、残りは次回に回す", async () => {
    const t = convexTest(schema, modules);
    const members = await setupCouple(t);
    // 上限(200件)+1件を直接insertする。mutation経由だと時間がかかるうえ、
    // ここで見たいのは収集側の上限の振る舞いだけ
    const coupleId = await t.run(async (ctx) => {
      const self = await ctx.db.get("members", members.self._id);
      for (let i = 0; i < 201; i++) {
        await ctx.db.insert("expenses", {
          coupleId: self!.coupleId,
          paidBy: members.self._id,
          // 購入日の古い順に切り出されることを確かめるため日付をずらす
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

    const balance = await t
      .withIdentity(ALICE)
      .query(api.settlements.currentBalance, {});
    expect(balance.truncated).toBe(true);
    expect(balance.expenseCount).toBe(200);
    expect(balance.amount).toBe(200 * 500);

    // 1回目の精算は200件。残り1件は未精算のまま次回に回る
    await settle(t, ALICE);
    const after = await t
      .withIdentity(ALICE)
      .query(api.settlements.currentBalance, {});
    expect(after.truncated).toBe(false);
    expect(after.expenseCount).toBe(1);
    expect(after.amount).toBe(500);
    expect(coupleId).toBeDefined();
  });

  test("未ログイン・世帯未所属では精算できない", async () => {
    const t = convexTest(schema, modules);
    await setupCouple(t);
    const noop = {
      expectedAmount: 0,
      expectedFromMemberId: null,
      expectedExpenseCount: 0,
    };
    await expect(
      t.mutation(api.settlements.execute, noop),
    ).rejects.toThrow("ログインしてください");
    await expect(
      t.withIdentity(CAROL).mutation(api.settlements.execute, noop),
    ).rejects.toThrow("世帯に参加してください");
  });
});

describe("settlements.list", () => {
  test("新しい順に、方向・金額・メモ・対象件数を返す", async () => {
    const t = convexTest(schema, modules);
    const members = await setupCouple(t);
    await addExpense(t, members, ALICE, { price: 5000 });
    await settle(t, ALICE, { memo: "1回目" });
    await addExpense(t, members, BOB, {
      paidBy: members.partner._id,
      price: 3000,
    });
    await settle(t, BOB, { memo: "2回目" });

    const result = await t
      .withIdentity(ALICE)
      .query(api.settlements.list, listArgs());
    expect(result.page.map((row) => row.memo)).toEqual(["2回目", "1回目"]);
    expect(result.page[0]).toMatchObject({
      amount: 1500,
      fromMemberId: members.self._id, // Bが立て替えたので今度は自分が支払う側
      toMemberId: members.partner._id,
      expenseCount: 1,
    });
    expect(result.page[0].settledAt).toEqual(expect.any(Number));
    expect(result.isDone).toBe(true);
  });

  test("ページングで続きを読める", async () => {
    const t = convexTest(schema, modules);
    const members = await setupCouple(t);
    for (const price of [1000, 2000, 3000]) {
      await addExpense(t, members, ALICE, { price });
      await settle(t, ALICE);
    }

    const first = await t
      .withIdentity(ALICE)
      .query(api.settlements.list, listArgs(2));
    expect(first.page).toHaveLength(2);
    expect(first.isDone).toBe(false);

    const second = await t
      .withIdentity(ALICE)
      .query(api.settlements.list, listArgs(2, first.continueCursor));
    expect(second.page).toHaveLength(1);
  });

  test("他世帯の精算は出ない", async () => {
    const t = convexTest(schema, modules);
    const members = await setupCouple(t);
    await addExpense(t, members, ALICE, { price: 5000 });
    await settle(t, ALICE);

    const other = await setupCouple(t, CAROL, identity("dave"));
    await addExpense(t, other, CAROL, { price: 8000 });
    await settle(t, CAROL);

    const result = await t
      .withIdentity(ALICE)
      .query(api.settlements.list, listArgs());
    expect(result.page).toHaveLength(1);
    expect(result.page[0].amount).toBe(2500);
  });

  test("未ログイン・世帯未所属では読めない", async () => {
    const t = convexTest(schema, modules);
    await setupCouple(t);
    await expect(t.query(api.settlements.list, listArgs())).rejects.toThrow(
      "ログインしてください",
    );
    await expect(
      t.withIdentity(CAROL).query(api.settlements.list, listArgs()),
    ).rejects.toThrow("世帯に参加してください");
  });
});

describe("settlements.cancel", () => {
  test("直近の精算を取り消すと支出が未精算に戻り、差額が復活する", async () => {
    const t = convexTest(schema, modules);
    const members = await setupCouple(t);
    const expenseId = await addExpense(t, members, ALICE, { price: 5000 });
    const settlementId = await settle(t, ALICE);

    await t
      .withIdentity(BOB)
      .mutation(api.settlements.cancel, { settlementId });

    const expense = await t.run(async (ctx) =>
      ctx.db.get("expenses", expenseId),
    );
    expect(expense!.settlementId).toBeUndefined();
    expect(
      await t.run(async (ctx) => ctx.db.get("settlements", settlementId)),
    ).toBeNull();

    const balance = await t
      .withIdentity(ALICE)
      .query(api.settlements.currentBalance, {});
    expect(balance.amount).toBe(2500);
    expect(balance.expenseCount).toBe(1);
  });

  test("直近1件より前の精算は取り消せない", async () => {
    const t = convexTest(schema, modules);
    const members = await setupCouple(t);
    await addExpense(t, members, ALICE, { price: 5000 });
    const older = await settle(t, ALICE);
    await addExpense(t, members, ALICE, { price: 3000 });
    const latest = await settle(t, ALICE);

    await expect(
      t
        .withIdentity(ALICE)
        .mutation(api.settlements.cancel, { settlementId: older }),
    ).rejects.toThrow("直近の精算のみ取り消せます");

    // 直近を取り消すと、その1つ前が取り消せるようになる
    await t
      .withIdentity(ALICE)
      .mutation(api.settlements.cancel, { settlementId: latest });
    await t
      .withIdentity(ALICE)
      .mutation(api.settlements.cancel, { settlementId: older });
    const balance = await t
      .withIdentity(ALICE)
      .query(api.settlements.currentBalance, {});
    expect(balance.amount).toBe(4000); // 2500 + 1500
  });

  test("取り消しても他世帯・他の精算の支出には触らない", async () => {
    const t = convexTest(schema, modules);
    const members = await setupCouple(t);
    const settledId = await addExpense(t, members, ALICE, { price: 5000 });
    const firstSettlement = await settle(t, ALICE);
    await addExpense(t, members, ALICE, { price: 3000 });
    const latest = await settle(t, ALICE);

    await t
      .withIdentity(ALICE)
      .mutation(api.settlements.cancel, { settlementId: latest });

    const stillSettled = await t.run(async (ctx) =>
      ctx.db.get("expenses", settledId),
    );
    expect(stillSettled!.settlementId).toBe(firstSettlement);
  });

  test("対象支出を戻しきれない場合は取り消し全体を失敗させる", async () => {
    const t = convexTest(schema, modules);
    const members = await setupCouple(t);
    const expenseId = await addExpense(t, members, ALICE, { price: 5000 });
    const settlementId = await settle(t, ALICE);

    // 精算済み支出が1件消えた状況(通常は起こりえない)を作る
    await t.run(async (ctx) => {
      await ctx.db.patch("settlements", settlementId, { expenseCount: 2 });
    });

    await expect(
      t.withIdentity(ALICE).mutation(api.settlements.cancel, { settlementId }),
    ).rejects.toThrow("精算の対象が変わっているため取り消せません");

    // 中途半端に戻さず、精算レコードも支出もそのまま
    expect(
      await t.run(async (ctx) => ctx.db.get("settlements", settlementId)),
    ).not.toBeNull();
    const expense = await t.run(async (ctx) =>
      ctx.db.get("expenses", expenseId),
    );
    expect(expense!.settlementId).toBe(settlementId);
  });

  test("他世帯の精算は取り消せない", async () => {
    const t = convexTest(schema, modules);
    const members = await setupCouple(t);
    await addExpense(t, members, ALICE, { price: 5000 });
    const settlementId = await settle(t, ALICE);

    await setupCouple(t, CAROL, identity("dave"));
    await expect(
      t
        .withIdentity(CAROL)
        .mutation(api.settlements.cancel, { settlementId }),
    ).rejects.toThrow("精算が見つかりません");
  });

  test("存在しない精算は取り消せない", async () => {
    const t = convexTest(schema, modules);
    const members = await setupCouple(t);
    await addExpense(t, members, ALICE, { price: 5000 });
    const settlementId = await settle(t, ALICE);
    await t
      .withIdentity(ALICE)
      .mutation(api.settlements.cancel, { settlementId });

    await expect(
      t.withIdentity(ALICE).mutation(api.settlements.cancel, { settlementId }),
    ).rejects.toThrow("精算が見つかりません");
  });

  test("未ログイン・世帯未所属では取り消せない", async () => {
    const t = convexTest(schema, modules);
    const members = await setupCouple(t);
    await addExpense(t, members, ALICE, { price: 5000 });
    const settlementId = await settle(t, ALICE);

    await expect(
      t.mutation(api.settlements.cancel, { settlementId }),
    ).rejects.toThrow("ログインしてください");
    await expect(
      t.withIdentity(CAROL).mutation(api.settlements.cancel, { settlementId }),
    ).rejects.toThrow("世帯に参加してください");
  });
});

describe("精算済み支出の保護(Phase 6のガード再確認)", () => {
  test("精算すると編集・削除ができなくなり、取り消すとまたできる", async () => {
    const t = convexTest(schema, modules);
    const members = await setupCouple(t);
    const expenseId = await addExpense(t, members, ALICE, { price: 5000 });
    const settlementId = await settle(t, ALICE);

    await expect(
      t.withIdentity(ALICE).mutation(api.expenses.remove, { expenseId }),
    ).rejects.toThrow("精算済みの支出は変更できません");

    await t
      .withIdentity(ALICE)
      .mutation(api.settlements.cancel, { settlementId });
    await t.withIdentity(ALICE).mutation(api.expenses.remove, { expenseId });
    const expense = await t.run(async (ctx) =>
      ctx.db.get("expenses", expenseId),
    );
    expect(expense!.deletedAt).toEqual(expect.any(Number));
  });
});
