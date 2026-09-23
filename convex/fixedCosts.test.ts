/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { StoredCategoryId } from "../lib/category";
import { monthInJst, nextMonth } from "../lib/fixed-cost";
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
const DAVE = identity("dave");

type Members = {
  self: { _id: Id<"members">; displayName: string };
  partner: { _id: Id<"members">; displayName: string };
};

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

const currentMonth = () => monthInJst(Date.now());
const split = (members: Members) => [
  { memberId: members.self._id, ratioPercent: 50 },
  { memberId: members.partner._id, ratioPercent: 50 },
];

function saveArgs(
  members: Members,
  overrides: Partial<{
    fixedCostId: Id<"fixedCosts">;
    name: string;
    amount: number;
    paidBy: Id<"members">;
    shares: { memberId: Id<"members">; ratioPercent: number }[];
    category: StoredCategoryId | null;
    startMonth: "this" | "next";
  }> = {},
) {
  return {
    name: "家賃",
    amount: 120000,
    paidBy: members.self._id,
    shares: split(members),
    category: "housing" as const,
    ...overrides,
  };
}

async function insertFixedCost(
  t: ReturnType<typeof convexTest>,
  coupleId: Id<"couples">,
  members: Members,
  overrides: Partial<{
    name: string;
    amount: number;
    paidBy: Id<"members">;
    shares: { memberId: Id<"members">; ratioPercent: number }[];
    category: StoredCategoryId;
    startMonth: string;
  }> = {},
) {
  return await t.run(async (ctx) =>
    ctx.db.insert("fixedCosts", {
      coupleId,
      name: "家賃",
      amount: 120000,
      paidBy: members.self._id,
      shares: split(members),
      startMonth: currentMonth(),
      ...overrides,
    }),
  );
}

async function insertExpenseFor(
  t: ReturnType<typeof convexTest>,
  coupleId: Id<"couples">,
  fixedCostId: Id<"fixedCosts">,
  members: Members,
  month: string,
  options: { deleted?: boolean; settled?: boolean } = {},
) {
  return await t.run(async (ctx) => {
    const settlementId = options.settled
      ? await ctx.db.insert("settlements", {
          coupleId,
          fromMemberId: members.partner._id,
          toMemberId: members.self._id,
          amount: 100,
          settledBy: members.self._id,
          expenseCount: 1,
        })
      : undefined;
    return await ctx.db.insert("expenses", {
      coupleId,
      paidBy: members.self._id,
      purchasedAt: `${month}-01`,
      totalAmount: 120000,
      items: [
        { name: "家賃", price: 120000, quantity: 1, shares: split(members) },
      ],
      source: "manual",
      status: "confirmed",
      fixedCost: { id: fixedCostId, month },
      ...(options.deleted ? { deletedAt: Date.now() } : {}),
      ...(settlementId === undefined ? {} : { settlementId }),
    });
  });
}

async function coupleIdOf(
  t: ReturnType<typeof convexTest>,
  owner = ALICE,
): Promise<Id<"couples">> {
  const member = await t.withIdentity(owner).query(api.couples.currentMember, {});
  if (member === null) {
    throw new Error("自分のメンバーが見つからない");
  }
  return member.coupleId;
}

describe("fixedCosts.save validation", () => {
  test("V-1101: 名目は1〜50文字でなければならない", async () => {
    const t = convexTest(schema, modules);
    const members = await setupCouple(t);

    for (const name of ["   ", "あ".repeat(51)]) {
      await expect(
        t.withIdentity(ALICE).mutation(
          api.fixedCosts.save,
          saveArgs(members, { name }),
        ),
      ).rejects.toThrow("名目は1〜50文字で入力してください");
    }
  });

  test("V-1102: 開始月は今月分か来月分に限る", async () => {
    const t = convexTest(schema, modules);
    const members = await setupCouple(t);

    await expect(
      t.withIdentity(ALICE).mutation(
        api.fixedCosts.save,
        saveArgs(members, { startMonth: "previous" as never }),
      ),
    ).rejects.toThrow();
  });

  test("V-403: 金額は1〜9,999,999円の整数に限る", async () => {
    const t = convexTest(schema, modules);
    const members = await setupCouple(t);

    for (const amount of [0, 1.5, 10_000_000]) {
      await expect(
        t.withIdentity(ALICE).mutation(
          api.fixedCosts.save,
          saveArgs(members, { amount }),
        ),
      ).rejects.toThrow(
        "金額は1円以上9,999,999円以下の整数で入力してください",
      );
    }
  });

  test("V-401: 負担割合の合計が100%でなければ拒否する", async () => {
    const t = convexTest(schema, modules);
    const members = await setupCouple(t);

    await expect(
      t.withIdentity(ALICE).mutation(
        api.fixedCosts.save,
        saveArgs(members, {
          shares: [
            { memberId: members.self._id, ratioPercent: 40 },
            { memberId: members.partner._id, ratioPercent: 40 },
          ],
        }),
      ),
    ).rejects.toThrow("負担割合の合計が100%になるようにしてください");
  });

  test("他世帯の支払者と負担メンバーを拒否する", async () => {
    const t = convexTest(schema, modules);
    const members = await setupCouple(t);
    const other = await setupCouple(t, CAROL, DAVE);

    await expect(
      t.withIdentity(ALICE).mutation(
        api.fixedCosts.save,
        saveArgs(members, { paidBy: other.self._id }),
      ),
    ).rejects.toThrow("権限がありません");
    await expect(
      t.withIdentity(ALICE).mutation(
        api.fixedCosts.save,
        saveArgs(members, {
          shares: [
            { memberId: members.self._id, ratioPercent: 50 },
            { memberId: other.partner._id, ratioPercent: 50 },
          ],
        }),
      ),
    ).rejects.toThrow("権限がありません");
  });

  test("変更・停止では不正IDと他世帯IDを同じ文言で拒否する", async () => {
    const t = convexTest(schema, modules);
    const members = await setupCouple(t);
    const fixedCostId = await t
      .withIdentity(ALICE)
      .mutation(api.fixedCosts.save, saveArgs(members));
    await setupCouple(t, CAROL, DAVE);

    await expect(
      t.withIdentity(ALICE).mutation(
        api.fixedCosts.save,
        saveArgs(members, { fixedCostId: "bogus" as Id<"fixedCosts"> }),
      ),
    ).rejects.toThrow("固定費が見つかりません");
    await expect(
      t.withIdentity(CAROL).mutation(
        api.fixedCosts.save,
        saveArgs(members, { fixedCostId }),
      ),
    ).rejects.toThrow("固定費が見つかりません");
    await expect(
      t.withIdentity(CAROL).mutation(api.fixedCosts.stop, { fixedCostId }),
    ).rejects.toThrow("固定費が見つかりません");
    await expect(
      t.withIdentity(ALICE).mutation(api.fixedCosts.stop, {
        fixedCostId: "bogus",
      }),
    ).rejects.toThrow("固定費が見つかりません");
  });
});

describe("fixedCosts.save and posting", () => {
  test("作成時に今月分を月初日・確定済みの手入力支出として計上する", async () => {
    const t = convexTest(schema, modules);
    const members = await setupCouple(t);
    const month = currentMonth();
    const fixedCostId = await t
      .withIdentity(ALICE)
      .mutation(api.fixedCosts.save, saveArgs(members, { startMonth: "this" }));
    const expense = await t.run(async (ctx) =>
      ctx.db
        .query("expenses")
        .withIndex("by_fixedCost_id_and_fixedCost_month", (q) =>
          q.eq("fixedCost.id", fixedCostId).eq("fixedCost.month", month),
        )
        .unique(),
    );

    expect(expense).toMatchObject({
      paidBy: members.self._id,
      purchasedAt: `${month}-01`,
      totalAmount: 120000,
      source: "manual",
      status: "confirmed",
      fixedCost: { id: fixedCostId, month },
      items: [{ name: "家賃", price: 120000, quantity: 1, shares: split(members) }],
    });
  });

  test("開始月が来月なら今月分を計上しない", async () => {
    const t = convexTest(schema, modules);
    const members = await setupCouple(t);
    const month = currentMonth();
    const fixedCostId = await t.withIdentity(ALICE).mutation(
      api.fixedCosts.save,
      saveArgs(members, { startMonth: "next" }),
    );

    expect(
      await t.run(async (ctx) =>
        ctx.db
          .query("expenses")
          .withIndex("by_fixedCost_id_and_fixedCost_month", (q) =>
            q.eq("fixedCost.id", fixedCostId).eq("fixedCost.month", month),
          )
          .take(2),
      ),
    ).toHaveLength(0);
  });

  test("postCurrentMonth を複数回実行しても同じ月を二重計上しない", async () => {
    const t = convexTest(schema, modules);
    const members = await setupCouple(t);
    const coupleId = await coupleIdOf(t);
    const month = currentMonth();
    const fixedCostId = await insertFixedCost(t, coupleId, members);

    await t.mutation(internal.fixedCosts.postCurrentMonth, {});
    await t.mutation(internal.fixedCosts.postCurrentMonth, {});

    const rows = await t.run(async (ctx) =>
      ctx.db
        .query("expenses")
        .withIndex("by_fixedCost_id_and_fixedCost_month", (q) =>
          q.eq("fixedCost.id", fixedCostId).eq("fixedCost.month", month),
        )
        .take(2),
    );
    expect(rows).toHaveLength(1);
  });

  test("今月分を削除しても計上済みの印が残り、再計上しない", async () => {
    const t = convexTest(schema, modules);
    const members = await setupCouple(t);
    const month = currentMonth();
    const fixedCostId = await t
      .withIdentity(ALICE)
      .mutation(api.fixedCosts.save, saveArgs(members));
    const expense = await t.run(async (ctx) =>
      ctx.db
        .query("expenses")
        .withIndex("by_fixedCost_id_and_fixedCost_month", (q) =>
          q.eq("fixedCost.id", fixedCostId).eq("fixedCost.month", month),
        )
        .unique(),
    );
    await t
      .withIdentity(ALICE)
      .mutation(api.expenses.remove, { expenseId: expense!._id });

    await t.mutation(internal.fixedCosts.postCurrentMonth, {});

    const rows = await t.run(async (ctx) =>
      ctx.db
        .query("expenses")
        .withIndex("by_fixedCost_id_and_fixedCost_month", (q) =>
          q.eq("fixedCost.id", fixedCostId).eq("fixedCost.month", month),
        )
        .take(2),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].deletedAt).toEqual(expect.any(Number));
  });

  test("支出編集では fixedCost の参照を維持する", async () => {
    const t = convexTest(schema, modules);
    const members = await setupCouple(t);
    const month = currentMonth();
    const fixedCostId = await t
      .withIdentity(ALICE)
      .mutation(api.fixedCosts.save, saveArgs(members));
    const expense = await t.run(async (ctx) =>
      ctx.db
        .query("expenses")
        .withIndex("by_fixedCost_id_and_fixedCost_month", (q) =>
          q.eq("fixedCost.id", fixedCostId).eq("fixedCost.month", month),
        )
        .unique(),
    );

    await t.withIdentity(ALICE).mutation(api.expenses.save, {
      expenseId: expense!._id,
      paidBy: members.self._id,
      purchasedAt: new Date(Date.now() + 9 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10),
      items: [
        { name: "修正後", price: 125000, quantity: 1, shares: split(members) },
      ],
      status: "confirmed",
      category: "housing",
    });

    const updated = await t.run(async (ctx) => ctx.db.get("expenses", expense!._id));
    expect(updated!.fixedCost).toEqual({ id: fixedCostId, month });
  });

  test("expenses.get と list は固定費のリンク情報を返す", async () => {
    const t = convexTest(schema, modules);
    const members = await setupCouple(t);
    const month = currentMonth();
    const fixedCostId = await t
      .withIdentity(ALICE)
      .mutation(api.fixedCosts.save, saveArgs(members));
    const expense = await t.run(async (ctx) =>
      ctx.db
        .query("expenses")
        .withIndex("by_fixedCost_id_and_fixedCost_month", (q) =>
          q.eq("fixedCost.id", fixedCostId).eq("fixedCost.month", month),
        )
        .unique(),
    );

    const detail = await t
      .withIdentity(ALICE)
      .query(api.expenses.get, { expenseId: expense!._id });
    const listed = await t.withIdentity(ALICE).query(api.expenses.list, {
      paginationOpts: { numItems: 20, cursor: null },
      filter: "all",
    });

    expect(detail!.fixedCost).toEqual({ id: fixedCostId, month });
    expect(
      listed.page.find((row) => row._id === expense!._id)?.fixedCost,
    ).toEqual({ id: fixedCostId, month });
  });

  test("テンプレート編集は計上済み支出を変更しない", async () => {
    const t = convexTest(schema, modules);
    const members = await setupCouple(t);
    const month = currentMonth();
    const fixedCostId = await t
      .withIdentity(ALICE)
      .mutation(api.fixedCosts.save, saveArgs(members));
    const expense = await t.run(async (ctx) =>
      ctx.db
        .query("expenses")
        .withIndex("by_fixedCost_id_and_fixedCost_month", (q) =>
          q.eq("fixedCost.id", fixedCostId).eq("fixedCost.month", month),
        )
        .unique(),
    );

    await t.withIdentity(ALICE).mutation(
      api.fixedCosts.save,
      saveArgs(members, { fixedCostId, name: "更新後の家賃", amount: 130000 }),
    );

    const unchanged = await t.run(async (ctx) => ctx.db.get("expenses", expense!._id));
    expect(unchanged!.totalAmount).toBe(120000);
    expect(unchanged!.items[0].name).toBe("家賃");
  });

  test("停止は冪等で、その後は計上されない", async () => {
    const t = convexTest(schema, modules);
    const members = await setupCouple(t);
    const month = currentMonth();
    const fixedCostId = await t
      .withIdentity(ALICE)
      .mutation(api.fixedCosts.save, saveArgs(members));

    await t.withIdentity(ALICE).mutation(api.fixedCosts.stop, { fixedCostId });
    const firstStop = await t.run(async (ctx) =>
      ctx.db.get("fixedCosts", fixedCostId),
    );
    await expect(
      t.withIdentity(ALICE).mutation(
        api.fixedCosts.save,
        saveArgs(members, { fixedCostId, amount: 130000 }),
      ),
    ).rejects.toThrow("停止した固定費は変更できません");
    await t.withIdentity(ALICE).mutation(api.fixedCosts.stop, { fixedCostId });
    vi.useFakeTimers();
    try {
      vi.setSystemTime(
        new Date(`${nextMonth(month)}-01T00:05:00+09:00`),
      );
      await t.mutation(internal.fixedCosts.postCurrentMonth, {});
    } finally {
      vi.useRealTimers();
    }
    const stopped = await t.run(async (ctx) => ctx.db.get("fixedCosts", fixedCostId));
    const rows = await t.run(async (ctx) =>
      ctx.db
        .query("expenses")
        .withIndex("by_fixedCost_id_and_fixedCost_month", (q) =>
          q.eq("fixedCost.id", fixedCostId).eq("fixedCost.month", month),
        )
        .take(2),
    );
    const nextMonthRows = await t.run(async (ctx) =>
      ctx.db
        .query("expenses")
        .withIndex("by_fixedCost_id_and_fixedCost_month", (q) =>
          q
            .eq("fixedCost.id", fixedCostId)
            .eq("fixedCost.month", nextMonth(month)),
        )
        .take(2),
    );

    expect(stopped!.stoppedAt).toBe(firstStop!.stoppedAt);
    expect(stopped!.stoppedReason).toBe("user");
    expect(rows).toHaveLength(1);
    expect(nextMonthRows).toHaveLength(0);
  });

  test("shares に退出済みメンバーがいると memberLeft で自動停止する", async () => {
    const t = convexTest(schema, modules);
    const members = await setupCouple(t);
    const coupleId = await coupleIdOf(t);
    const fixedCostId = await insertFixedCost(t, coupleId, members);
    await t.run(async (ctx) =>
      ctx.db.patch("members", members.partner._id, { leftAt: Date.now() }),
    );

    await t.mutation(internal.fixedCosts.postCurrentMonth, {});

    const stopped = await t.run(async (ctx) =>
      ctx.db.get("fixedCosts", fixedCostId),
    );
    const rows = await t.run(async (ctx) =>
      ctx.db
        .query("expenses")
        .withIndex("by_fixedCost_id_and_fixedCost_month", (q) =>
          q.eq("fixedCost.id", fixedCostId).eq("fixedCost.month", currentMonth()),
        )
        .take(2),
    );
    expect(stopped!.stoppedReason).toBe("memberLeft");
    expect(stopped!.stoppedAt).toEqual(expect.any(Number));
    expect(rows).toHaveLength(0);
  });
});

describe("fixedCosts.list and get", () => {
  test("thisMonth は計上済み・削除済み・未計上・開始前を区別する", async () => {
    const t = convexTest(schema, modules);
    const members = await setupCouple(t);
    const coupleId = await coupleIdOf(t);
    const month = currentMonth();
    const postedId = await insertFixedCost(t, coupleId, members, {
      name: "posted",
    });
    const deletedId = await insertFixedCost(t, coupleId, members, {
      name: "deleted",
    });
    await insertFixedCost(t, coupleId, members, { name: "notPosted" });
    await insertFixedCost(t, coupleId, members, {
      name: "notStarted",
      startMonth: nextMonth(month),
    });
    const stoppedId = await t.withIdentity(ALICE).mutation(
      api.fixedCosts.save,
      saveArgs(members, { name: "stopped", startMonth: "next" }),
    );
    await t.withIdentity(ALICE).mutation(api.fixedCosts.stop, {
      fixedCostId: stoppedId,
    });
    await insertExpenseFor(t, coupleId, postedId, members, month);
    await insertExpenseFor(t, coupleId, deletedId, members, month, {
      deleted: true,
    });

    const result = await t
      .withIdentity(ALICE)
      .query(api.fixedCosts.list, { month });
    const statusByName = Object.fromEntries(
      result.active.map((row) => [row.name, row.thisMonth]),
    );
    expect(statusByName).toEqual({
      posted: "posted",
      deleted: "deleted",
      notPosted: "notPosted",
      notStarted: "notStarted",
    });
    expect(result.stopped.map((row) => row.name)).toEqual(["stopped"]);
  });

  test("詳細は履歴を返し、他世帯や不正IDは null を返す", async () => {
    const t = convexTest(schema, modules);
    const members = await setupCouple(t);
    const coupleId = await coupleIdOf(t);
    const month = currentMonth();
    const fixedCostId = await insertFixedCost(t, coupleId, members);
    const expenseId = await insertExpenseFor(
      t,
      coupleId,
      fixedCostId,
      members,
      month,
      { deleted: true, settled: true },
    );
    await setupCouple(t, CAROL, DAVE);

    const detail = await t
      .withIdentity(ALICE)
      .query(api.fixedCosts.get, { fixedCostId });
    expect(detail!.history).toEqual([
      {
        month,
        expenseId,
        totalAmount: 120000,
        deleted: true,
        settled: true,
      },
    ]);
    await expect(
      t.withIdentity(CAROL).query(api.fixedCosts.get, { fixedCostId }),
    ).resolves.toBeNull();
    await expect(
      t.withIdentity(ALICE).query(api.fixedCosts.get, { fixedCostId: "bogus" }),
    ).resolves.toBeNull();
  });
});

test("26件以上の active 固定費は継続スケジュールされてすべて計上する", async () => {
  const t = convexTest(schema, modules);
  const members = await setupCouple(t);
  const coupleId = await coupleIdOf(t);
  const month = currentMonth();
  await t.run(async (ctx) => {
    for (let i = 0; i < 26; i += 1) {
      await ctx.db.insert("fixedCosts", {
        coupleId,
        name: `固定費${i}`,
        amount: 100 + i,
        paidBy: members.self._id,
        shares: split(members),
        startMonth: month,
      });
    }
  });

  vi.useFakeTimers();
  try {
    await t.mutation(internal.fixedCosts.postCurrentMonth, {});
    await t.finishAllScheduledFunctions(vi.runAllTimers);
  } finally {
    vi.useRealTimers();
  }

  const rows = await t.run(async (ctx) =>
    (
      await ctx.db
        .query("expenses")
        .withIndex("by_coupleId_and_purchasedAt", (q) =>
          q.eq("coupleId", coupleId),
        )
        .take(30)
    ).filter((row) => row.fixedCost?.month === month),
  );
  expect(rows).toHaveLength(26);
});
