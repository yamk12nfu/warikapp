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

// 手入力(品目1件・折半・当日・確定)の標準的な引数
function manualArgs(
  members: Members,
  overrides: Partial<{
    expenseId: Id<"expenses">;
    paidBy: Id<"members">;
    storeName: string;
    purchasedAt: string;
    items: {
      name: string;
      price: number;
      quantity: number;
      shares: { memberId: Id<"members">; ratioPercent: number }[];
    }[];
    source: "receipt" | "manual";
    status: "draft" | "confirmed";
  }> = {},
) {
  return {
    paidBy: members.self._id,
    purchasedAt: jstDate(),
    items: [
      { name: "焼肉", price: 5000, quantity: 1, shares: split(members) },
    ],
    source: "manual" as const,
    status: "confirmed" as const,
    ...overrides,
  };
}

describe("expenses.save(新規作成)", () => {
  test("手入力の支出を保存し、totalAmount を品目合計から算出する", async () => {
    const t = convexTest(schema, modules);
    const members = await setupCouple(t);

    const expenseId = await t.withIdentity(ALICE).mutation(
      api.expenses.save,
      manualArgs(members, {
        storeName: "  やまだ精肉店  ",
        items: [
          { name: " 牛肉 ", price: 3000, quantity: 2, shares: split(members) },
          {
            name: "ビール",
            price: 500,
            quantity: 1,
            shares: [{ memberId: members.self._id, ratioPercent: 100 }],
          },
        ],
      }),
    );

    const expense = await t.run(async (ctx) => ctx.db.get("expenses", expenseId));
    expect(expense).not.toBeNull();
    expect(expense!.totalAmount).toBe(6500); // 3000×2 + 500
    expect(expense!.storeName).toBe("やまだ精肉店"); // 前後の空白を除去
    expect(expense!.items[0].name).toBe("牛肉");
    expect(expense!.source).toBe("manual");
    expect(expense!.status).toBe("confirmed");
    expect(expense!.coupleId).toBe(
      await t.run(async (ctx) => {
        const member = await ctx.db.get("members", members.self._id);
        return member!.coupleId;
      }),
    );
    expect(expense!.settlementId).toBeUndefined(); // 未精算
    expect(expense!.deletedAt).toBeUndefined();
  });

  test("店名は任意。空文字なら保存しない", async () => {
    const t = convexTest(schema, modules);
    const members = await setupCouple(t);
    const expenseId = await t
      .withIdentity(ALICE)
      .mutation(api.expenses.save, manualArgs(members, { storeName: "   " }));
    const expense = await t.run(async (ctx) => ctx.db.get("expenses", expenseId));
    expect(expense!.storeName).toBeUndefined();
  });

  test("source を省略すると手入力扱いになる", async () => {
    const t = convexTest(schema, modules);
    const members = await setupCouple(t);
    const expenseId = await t
      .withIdentity(ALICE)
      .mutation(api.expenses.save, manualArgs(members, { source: undefined }));
    const expense = await t.run(async (ctx) => ctx.db.get("expenses", expenseId));
    expect(expense!.source).toBe("manual");
  });

  test("ドラフトとして保存できる", async () => {
    const t = convexTest(schema, modules);
    const members = await setupCouple(t);
    const expenseId = await t
      .withIdentity(ALICE)
      .mutation(api.expenses.save, manualArgs(members, { status: "draft" }));
    const expense = await t.run(async (ctx) => ctx.db.get("expenses", expenseId));
    expect(expense!.status).toBe("draft");
  });

  test("支払者は相手も指定できる", async () => {
    const t = convexTest(schema, modules);
    const members = await setupCouple(t);
    const expenseId = await t
      .withIdentity(ALICE)
      .mutation(
        api.expenses.save,
        manualArgs(members, { paidBy: members.partner._id }),
      );
    const expense = await t.run(async (ctx) => ctx.db.get("expenses", expenseId));
    expect(expense!.paidBy).toBe(members.partner._id);
  });

  test("パートナーも同じ世帯の支出を登録できる", async () => {
    const t = convexTest(schema, modules);
    const members = await setupCouple(t);
    const expenseId = await t
      .withIdentity(BOB)
      .mutation(
        api.expenses.save,
        manualArgs(members, { paidBy: members.partner._id }),
      );
    expect(expenseId).toBeDefined();
  });
});

describe("expenses.save(バリデーション)", () => {
  test("V-402: 品目が0件なら拒否する", async () => {
    const t = convexTest(schema, modules);
    const members = await setupCouple(t);
    await expect(
      t
        .withIdentity(ALICE)
        .mutation(api.expenses.save, manualArgs(members, { items: [] })),
    ).rejects.toThrow("品目を1件以上入力してください");
  });

  test("V-402: 品目は100件まで", async () => {
    const t = convexTest(schema, modules);
    const members = await setupCouple(t);
    const item = {
      name: "品目",
      price: 100,
      quantity: 1,
      shares: split(members),
    };
    await expect(
      t.withIdentity(ALICE).mutation(
        api.expenses.save,
        manualArgs(members, { items: Array.from({ length: 101 }, () => item) }),
      ),
    ).rejects.toThrow("品目は100件までです");
  });

  test("V-403: 金額が0・小数・上限超なら拒否する", async () => {
    const t = convexTest(schema, modules);
    const members = await setupCouple(t);
    for (const price of [0, -100, 1.5, 10_000_000]) {
      await expect(
        t.withIdentity(ALICE).mutation(
          api.expenses.save,
          manualArgs(members, {
            items: [
              { name: "焼肉", price, quantity: 1, shares: split(members) },
            ],
          }),
        ),
      ).rejects.toThrow("金額は1円以上9,999,999円以下の整数で入力してください");
    }
  });

  test("V-403: 上限ちょうど(9,999,999円)は保存できる", async () => {
    const t = convexTest(schema, modules);
    const members = await setupCouple(t);
    const expenseId = await t.withIdentity(ALICE).mutation(
      api.expenses.save,
      manualArgs(members, {
        items: [
          {
            name: "高額品",
            price: 9_999_999,
            quantity: 1,
            shares: split(members),
          },
        ],
      }),
    );
    expect(expenseId).toBeDefined();
  });

  test("V-401: 負担割合の合計が100%でなければ拒否する", async () => {
    const t = convexTest(schema, modules);
    const members = await setupCouple(t);
    for (const shares of [
      [
        { memberId: members.self._id, ratioPercent: 50 },
        { memberId: members.partner._id, ratioPercent: 40 },
      ],
      [
        { memberId: members.self._id, ratioPercent: 70 },
        { memberId: members.partner._id, ratioPercent: 70 },
      ],
      [],
    ]) {
      await expect(
        t.withIdentity(ALICE).mutation(
          api.expenses.save,
          manualArgs(members, {
            items: [{ name: "焼肉", price: 5000, quantity: 1, shares }],
          }),
        ),
      ).rejects.toThrow("負担割合の合計が100%になるようにしてください");
    }
  });

  test("V-401: カスタム割合(70:30)は保存できる", async () => {
    const t = convexTest(schema, modules);
    const members = await setupCouple(t);
    const expenseId = await t.withIdentity(ALICE).mutation(
      api.expenses.save,
      manualArgs(members, {
        items: [
          {
            name: "焼肉",
            price: 5000,
            quantity: 1,
            shares: [
              { memberId: members.self._id, ratioPercent: 70 },
              { memberId: members.partner._id, ratioPercent: 30 },
            ],
          },
        ],
      }),
    );
    const expense = await t.run(async (ctx) => ctx.db.get("expenses", expenseId));
    expect(expense!.items[0].shares).toEqual([
      { memberId: members.self._id, ratioPercent: 70 },
      { memberId: members.partner._id, ratioPercent: 30 },
    ]);
  });

  test("負担割合が整数以外・範囲外なら拒否する", async () => {
    const t = convexTest(schema, modules);
    const members = await setupCouple(t);
    for (const shares of [
      [
        { memberId: members.self._id, ratioPercent: 50.5 },
        { memberId: members.partner._id, ratioPercent: 49.5 },
      ],
      [
        { memberId: members.self._id, ratioPercent: -10 },
        { memberId: members.partner._id, ratioPercent: 110 },
      ],
    ]) {
      await expect(
        t.withIdentity(ALICE).mutation(
          api.expenses.save,
          manualArgs(members, {
            items: [{ name: "焼肉", price: 5000, quantity: 1, shares }],
          }),
        ),
      ).rejects.toThrow("負担割合は0〜100の整数で入力してください");
    }
  });

  test("同じメンバーの負担割合が重複していれば拒否する", async () => {
    const t = convexTest(schema, modules);
    const members = await setupCouple(t);
    await expect(
      t.withIdentity(ALICE).mutation(
        api.expenses.save,
        manualArgs(members, {
          items: [
            {
              name: "焼肉",
              price: 5000,
              quantity: 1,
              shares: [
                { memberId: members.self._id, ratioPercent: 50 },
                { memberId: members.self._id, ratioPercent: 50 },
              ],
            },
          ],
        }),
      ),
    ).rejects.toThrow("同じメンバーの負担割合が重複しています");
  });

  test("品目名が空・51文字なら拒否する", async () => {
    const t = convexTest(schema, modules);
    const members = await setupCouple(t);
    for (const name of ["   ", "あ".repeat(51)]) {
      await expect(
        t.withIdentity(ALICE).mutation(
          api.expenses.save,
          manualArgs(members, {
            items: [
              { name, price: 5000, quantity: 1, shares: split(members) },
            ],
          }),
        ),
      ).rejects.toThrow("品目名は1〜50文字で入力してください");
    }
  });

  test("数量が0・小数・1000以上なら拒否する", async () => {
    const t = convexTest(schema, modules);
    const members = await setupCouple(t);
    for (const quantity of [0, 1.5, 1000]) {
      await expect(
        t.withIdentity(ALICE).mutation(
          api.expenses.save,
          manualArgs(members, {
            items: [
              { name: "牛肉", price: 500, quantity, shares: split(members) },
            ],
          }),
        ),
      ).rejects.toThrow("数量は1〜999の整数で入力してください");
    }
  });

  test("店名が51文字なら拒否する", async () => {
    const t = convexTest(schema, modules);
    const members = await setupCouple(t);
    await expect(
      t
        .withIdentity(ALICE)
        .mutation(
          api.expenses.save,
          manualArgs(members, { storeName: "あ".repeat(51) }),
        ),
    ).rejects.toThrow("店名は50文字以内で入力してください");
  });

  test("購入日の形式が不正・実在しない日付なら拒否する", async () => {
    const t = convexTest(schema, modules);
    const members = await setupCouple(t);
    for (const purchasedAt of ["2026/07/26", "2026-7-1", "", "2026-02-31"]) {
      await expect(
        t
          .withIdentity(ALICE)
          .mutation(api.expenses.save, manualArgs(members, { purchasedAt })),
      ).rejects.toThrow("購入日を正しく入力してください");
    }
  });

  test("購入日が未来なら拒否し、当日・過去は許可する", async () => {
    const t = convexTest(schema, modules);
    const members = await setupCouple(t);
    await expect(
      t
        .withIdentity(ALICE)
        .mutation(
          api.expenses.save,
          manualArgs(members, { purchasedAt: jstDate(1) }),
        ),
    ).rejects.toThrow("購入日に未来の日付は指定できません");

    for (const purchasedAt of [jstDate(), jstDate(-30)]) {
      const expenseId = await t
        .withIdentity(ALICE)
        .mutation(api.expenses.save, manualArgs(members, { purchasedAt }));
      expect(expenseId).toBeDefined();
    }
  });
});

describe("expenses.save(認証・テナント分離)", () => {
  test("未ログインでは保存できない", async () => {
    const t = convexTest(schema, modules);
    const members = await setupCouple(t);
    await expect(
      t.mutation(api.expenses.save, manualArgs(members)),
    ).rejects.toThrow("ログインしてください");
  });

  test("世帯未所属では保存できない", async () => {
    const t = convexTest(schema, modules);
    const members = await setupCouple(t);
    await expect(
      t.withIdentity(CAROL).mutation(api.expenses.save, manualArgs(members)),
    ).rejects.toThrow("世帯に参加してください");
  });

  test("他世帯のメンバーを支払者に指定できない", async () => {
    const t = convexTest(schema, modules);
    const members = await setupCouple(t);
    const other = await setupCouple(t, CAROL, identity("dave"));
    await expect(
      t
        .withIdentity(ALICE)
        .mutation(
          api.expenses.save,
          manualArgs(members, { paidBy: other.self._id }),
        ),
    ).rejects.toThrow("権限がありません");
  });

  test("他世帯のメンバーを負担者に混ぜられない", async () => {
    const t = convexTest(schema, modules);
    const members = await setupCouple(t);
    const other = await setupCouple(t, CAROL, identity("dave"));
    await expect(
      t.withIdentity(ALICE).mutation(
        api.expenses.save,
        manualArgs(members, {
          items: [
            {
              name: "焼肉",
              price: 5000,
              quantity: 1,
              shares: [
                { memberId: members.self._id, ratioPercent: 50 },
                { memberId: other.self._id, ratioPercent: 50 },
              ],
            },
          ],
        }),
      ),
    ).rejects.toThrow("権限がありません");
  });

  test("他世帯の支出は更新できない", async () => {
    const t = convexTest(schema, modules);
    const members = await setupCouple(t);
    const expenseId = await t
      .withIdentity(ALICE)
      .mutation(api.expenses.save, manualArgs(members));

    const other = await setupCouple(t, CAROL, identity("dave"));
    await expect(
      t
        .withIdentity(CAROL)
        .mutation(
          api.expenses.save,
          manualArgs(other, { expenseId, paidBy: other.self._id }),
        ),
    ).rejects.toThrow("支出が見つかりません");
  });
});

describe("expenses.save(更新)", () => {
  test("品目を差し替えると totalAmount も更新される", async () => {
    const t = convexTest(schema, modules);
    const members = await setupCouple(t);
    const expenseId = await t
      .withIdentity(ALICE)
      .mutation(api.expenses.save, manualArgs(members, { storeName: "居酒屋" }));

    const updatedId = await t.withIdentity(BOB).mutation(
      api.expenses.save,
      manualArgs(members, {
        expenseId,
        items: [
          { name: "牛肉", price: 1200, quantity: 3, shares: split(members) },
        ],
      }),
    );
    expect(updatedId).toBe(expenseId); // 同じ支出を更新する

    const expense = await t.run(async (ctx) => ctx.db.get("expenses", expenseId));
    expect(expense!.totalAmount).toBe(3600);
    expect(expense!.items).toHaveLength(1);
    // 店名を空にすると項目が消える(任意項目)
    expect(expense!.storeName).toBeUndefined();
  });

  test("精算済みの支出は変更できない", async () => {
    const t = convexTest(schema, modules);
    const members = await setupCouple(t);
    const expenseId = await t
      .withIdentity(ALICE)
      .mutation(api.expenses.save, manualArgs(members));

    await t.run(async (ctx) => {
      const expense = await ctx.db.get("expenses", expenseId);
      const settlementId = await ctx.db.insert("settlements", {
        coupleId: expense!.coupleId,
        fromMemberId: members.partner._id,
        toMemberId: members.self._id,
        amount: 2500,
        settledBy: members.self._id,
      });
      await ctx.db.patch("expenses", expenseId, { settlementId });
    });

    await expect(
      t
        .withIdentity(ALICE)
        .mutation(api.expenses.save, manualArgs(members, { expenseId })),
    ).rejects.toThrow("精算済みの支出は変更できません");
  });

  test("削除済みの支出は更新できない", async () => {
    const t = convexTest(schema, modules);
    const members = await setupCouple(t);
    const expenseId = await t
      .withIdentity(ALICE)
      .mutation(api.expenses.save, manualArgs(members));
    await t.run(async (ctx) => {
      await ctx.db.patch("expenses", expenseId, { deletedAt: Date.now() });
    });

    await expect(
      t
        .withIdentity(ALICE)
        .mutation(api.expenses.save, manualArgs(members, { expenseId })),
    ).rejects.toThrow("支出が見つかりません");
  });

  test("存在しない支出IDでは更新できない", async () => {
    const t = convexTest(schema, modules);
    const members = await setupCouple(t);
    const expenseId = await t
      .withIdentity(ALICE)
      .mutation(api.expenses.save, manualArgs(members));
    await t.run(async (ctx) => {
      await ctx.db.delete("expenses", expenseId);
    });

    await expect(
      t
        .withIdentity(ALICE)
        .mutation(api.expenses.save, manualArgs(members, { expenseId })),
    ).rejects.toThrow("支出が見つかりません");
  });

  test("更新時も source は変わらない", async () => {
    const t = convexTest(schema, modules);
    const members = await setupCouple(t);
    const expenseId = await t
      .withIdentity(ALICE)
      .mutation(api.expenses.save, manualArgs(members, { source: "receipt" }));
    await t
      .withIdentity(ALICE)
      .mutation(
        api.expenses.save,
        manualArgs(members, { expenseId, source: "manual" }),
      );
    const expense = await t.run(async (ctx) => ctx.db.get("expenses", expenseId));
    expect(expense!.source).toBe("receipt");
  });
});
