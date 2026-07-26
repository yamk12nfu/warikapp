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
    await t.withIdentity(ALICE).mutation(api.settlements.execute, {});

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

    const settlementId = await t
      .withIdentity(ALICE)
      .mutation(api.settlements.execute, { memo: "  6月分  " });

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
    const settlementId = await t
      .withIdentity(BOB)
      .mutation(api.settlements.execute, {});
    const settlement = await t.run(async (ctx) =>
      ctx.db.get("settlements", settlementId),
    );
    expect(settlement!.amount).toBe(1500);
    // 実行者がBでも向きは「BがAに支払う」のまま
    expect(settlement!.fromMemberId).toBe(members.partner._id);
    expect(settlement!.toMemberId).toBe(members.self._id);
    expect(settlement!.settledBy).toBe(members.partner._id);
  });

  test("V-701: ドラフトが残っていたら拒否する", async () => {
    const t = convexTest(schema, modules);
    const members = await setupCouple(t);
    await addExpense(t, members, ALICE, { price: 5000 });
    await addExpense(t, members, ALICE, { status: "draft" });

    await expect(
      t.withIdentity(ALICE).mutation(api.settlements.execute, {}),
    ).rejects.toThrow("未確定のレシートがあります");
  });

  test("V-701: 対象0件なら拒否する", async () => {
    const t = convexTest(schema, modules);
    await setupCouple(t);
    await expect(
      t.withIdentity(ALICE).mutation(api.settlements.execute, {}),
    ).rejects.toThrow("精算対象がありません");
  });

  test("V-702: 続けて実行しても2件目は対象が無く失敗する", async () => {
    const t = convexTest(schema, modules);
    const members = await setupCouple(t);
    await addExpense(t, members, ALICE, { price: 5000 });

    await t.withIdentity(ALICE).mutation(api.settlements.execute, {});
    await expect(
      t.withIdentity(ALICE).mutation(api.settlements.execute, {}),
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

    const settlementId = await t
      .withIdentity(ALICE)
      .mutation(api.settlements.execute, {});
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
      t
        .withIdentity(ALICE)
        .mutation(api.settlements.execute, { memo: "あ".repeat(101) }),
    ).rejects.toThrow("メモは100文字以内で入力してください");

    const settlementId = await t
      .withIdentity(ALICE)
      .mutation(api.settlements.execute, { memo: "   " });
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

    const settlementId = await t
      .withIdentity(ALICE)
      .mutation(api.settlements.execute, {});
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

    await t.withIdentity(ALICE).mutation(api.settlements.execute, {});

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
      t.withIdentity(ALICE).mutation(api.settlements.execute, {}),
    ).rejects.toThrow("パートナーが参加してから精算してください");
  });

  test("未ログイン・世帯未所属では精算できない", async () => {
    const t = convexTest(schema, modules);
    await setupCouple(t);
    await expect(t.mutation(api.settlements.execute, {})).rejects.toThrow(
      "ログインしてください",
    );
    await expect(
      t.withIdentity(CAROL).mutation(api.settlements.execute, {}),
    ).rejects.toThrow("世帯に参加してください");
  });
});

describe("settlements.list", () => {
  test("新しい順に、方向・金額・メモ・対象件数を返す", async () => {
    const t = convexTest(schema, modules);
    const members = await setupCouple(t);
    await addExpense(t, members, ALICE, { price: 5000 });
    await t
      .withIdentity(ALICE)
      .mutation(api.settlements.execute, { memo: "1回目" });
    await addExpense(t, members, BOB, {
      paidBy: members.partner._id,
      price: 3000,
    });
    await t
      .withIdentity(BOB)
      .mutation(api.settlements.execute, { memo: "2回目" });

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
      await t.withIdentity(ALICE).mutation(api.settlements.execute, {});
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
    await t.withIdentity(ALICE).mutation(api.settlements.execute, {});

    const other = await setupCouple(t, CAROL, identity("dave"));
    await addExpense(t, other, CAROL, { price: 8000 });
    await t.withIdentity(CAROL).mutation(api.settlements.execute, {});

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
    const settlementId = await t
      .withIdentity(ALICE)
      .mutation(api.settlements.execute, {});

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
    const older = await t
      .withIdentity(ALICE)
      .mutation(api.settlements.execute, {});
    await addExpense(t, members, ALICE, { price: 3000 });
    const latest = await t
      .withIdentity(ALICE)
      .mutation(api.settlements.execute, {});

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
    const firstSettlement = await t
      .withIdentity(ALICE)
      .mutation(api.settlements.execute, {});
    await addExpense(t, members, ALICE, { price: 3000 });
    const latest = await t
      .withIdentity(ALICE)
      .mutation(api.settlements.execute, {});

    await t
      .withIdentity(ALICE)
      .mutation(api.settlements.cancel, { settlementId: latest });

    const stillSettled = await t.run(async (ctx) =>
      ctx.db.get("expenses", settledId),
    );
    expect(stillSettled!.settlementId).toBe(firstSettlement);
  });

  test("他世帯の精算は取り消せない", async () => {
    const t = convexTest(schema, modules);
    const members = await setupCouple(t);
    await addExpense(t, members, ALICE, { price: 5000 });
    const settlementId = await t
      .withIdentity(ALICE)
      .mutation(api.settlements.execute, {});

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
    const settlementId = await t
      .withIdentity(ALICE)
      .mutation(api.settlements.execute, {});
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
    const settlementId = await t
      .withIdentity(ALICE)
      .mutation(api.settlements.execute, {});

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
    const settlementId = await t
      .withIdentity(ALICE)
      .mutation(api.settlements.execute, {});

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
