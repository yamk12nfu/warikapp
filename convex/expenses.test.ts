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
    imageStorageId: Id<"_storage">;
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
        expenseCount: 1,
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

// レシート画像の紐付け(Phase 8)。クライアント由来の storageId は
// uploads 台帳で自世帯のものかを検証してから保存する
describe("expenses.save(レシート画像)", () => {
  // 画像を保存し、指定したユーザーの世帯のものとして台帳に登録する
  async function uploadFor(t: ReturnType<typeof convexTest>, who = ALICE) {
    const storageId = await t.run(async (ctx) =>
      ctx.storage.store(new Blob(["receipt"], { type: "image/jpeg" })),
    );
    await t
      .withIdentity(who)
      .mutation(api.uploads.registerUpload, { storageId });
    return storageId;
  }

  test("自世帯がアップロードした画像を紐付けられる", async () => {
    const t = convexTest(schema, modules);
    const members = await setupCouple(t);
    const imageStorageId = await uploadFor(t);

    const expenseId = await t.withIdentity(ALICE).mutation(
      api.expenses.save,
      manualArgs(members, { source: "receipt", imageStorageId }),
    );

    const expense = await t
      .withIdentity(ALICE)
      .query(api.expenses.get, { expenseId });
    expect(expense!.hasImage).toBe(true);
    expect(
      await t.withIdentity(ALICE).query(api.expenses.getImageUrl, { expenseId }),
    ).toEqual(expect.any(String));
  });

  test("台帳にないstorageIdは紐付けられない", async () => {
    const t = convexTest(schema, modules);
    const members = await setupCouple(t);
    const imageStorageId = await t.run(async (ctx) =>
      ctx.storage.store(new Blob(["receipt"], { type: "image/jpeg" })),
    );

    await expect(
      t.withIdentity(ALICE).mutation(
        api.expenses.save,
        manualArgs(members, { source: "receipt", imageStorageId }),
      ),
    ).rejects.toThrow("この画像は利用できません");
  });

  test("他世帯がアップロードした画像は紐付けられない", async () => {
    const t = convexTest(schema, modules);
    await setupCouple(t);
    const imageStorageId = await uploadFor(t);

    const others = await setupCouple(t, CAROL, identity("dave"));
    await expect(
      t.withIdentity(CAROL).mutation(
        api.expenses.save,
        manualArgs(others, { source: "receipt", imageStorageId }),
      ),
    ).rejects.toThrow("この画像は利用できません");
  });

  test("更新時に省略しても画像は消えない(編集画面は画像を扱わない)", async () => {
    const t = convexTest(schema, modules);
    const members = await setupCouple(t);
    const imageStorageId = await uploadFor(t);
    const expenseId = await t.withIdentity(ALICE).mutation(
      api.expenses.save,
      manualArgs(members, { source: "receipt", imageStorageId, status: "draft" }),
    );

    await t
      .withIdentity(ALICE)
      .mutation(api.expenses.save, manualArgs(members, { expenseId }));

    const expense = await t.run(async (ctx) => ctx.db.get("expenses", expenseId));
    expect(expense!.imageStorageId).toBe(imageStorageId);
  });
});

// 支出を精算済みにする(精算そのものは Phase 7。ここではガードの検証用)
async function markSettled(
  t: ReturnType<typeof convexTest>,
  members: Members,
  expenseId: Id<"expenses">,
) {
  await t.run(async (ctx) => {
    const expense = await ctx.db.get("expenses", expenseId);
    const settlementId = await ctx.db.insert("settlements", {
      coupleId: expense!.coupleId,
      fromMemberId: members.partner._id,
      toMemberId: members.self._id,
      amount: 2500,
      settledBy: members.self._id,
      expenseCount: 1,
    });
    await ctx.db.patch("expenses", expenseId, { settlementId });
  });
}

const listArgs = (
  filter: "unsettled" | "all",
  numItems = 20,
  cursor: string | null = null,
) => ({ paginationOpts: { numItems, cursor }, filter });

describe("expenses.list", () => {
  test("購入日の降順に返す", async () => {
    const t = convexTest(schema, modules);
    const members = await setupCouple(t);
    for (const purchasedAt of [jstDate(-2), jstDate(), jstDate(-1)]) {
      await t
        .withIdentity(ALICE)
        .mutation(api.expenses.save, manualArgs(members, { purchasedAt }));
    }

    const result = await t
      .withIdentity(ALICE)
      .query(api.expenses.list, listArgs("unsettled"));
    expect(result.page.map((row) => row.purchasedAt)).toEqual([
      jstDate(),
      jstDate(-1),
      jstDate(-2),
    ]);
    expect(result.isDone).toBe(true);
  });

  test("行には見出し・合計・支払者・状態を含む", async () => {
    const t = convexTest(schema, modules);
    const members = await setupCouple(t);
    await t.withIdentity(ALICE).mutation(
      api.expenses.save,
      manualArgs(members, {
        storeName: "やまだ精肉店",
        items: [
          { name: "牛肉", price: 3000, quantity: 2, shares: split(members) },
          { name: "ビール", price: 500, quantity: 1, shares: split(members) },
        ],
      }),
    );

    const result = await t
      .withIdentity(ALICE)
      .query(api.expenses.list, listArgs("unsettled"));
    expect(result.page[0]).toMatchObject({
      title: "やまだ精肉店",
      itemCount: 2,
      totalAmount: 6500,
      paidBy: members.self._id,
      status: "confirmed",
      settled: false,
    });
  });

  test("店名が無ければ先頭の品目名を見出しにする", async () => {
    const t = convexTest(schema, modules);
    const members = await setupCouple(t);
    await t
      .withIdentity(ALICE)
      .mutation(api.expenses.save, manualArgs(members)); // 品目は「焼肉」
    const result = await t
      .withIdentity(ALICE)
      .query(api.expenses.list, listArgs("unsettled"));
    expect(result.page[0].title).toBe("焼肉");
  });

  test("未精算のみ(既定)は精算済みを除き、すべてなら含める", async () => {
    const t = convexTest(schema, modules);
    const members = await setupCouple(t);
    const settledId = await t
      .withIdentity(ALICE)
      .mutation(api.expenses.save, manualArgs(members, { storeName: "精算済み" }));
    await markSettled(t, members, settledId);
    await t
      .withIdentity(ALICE)
      .mutation(api.expenses.save, manualArgs(members, { storeName: "未精算" }));

    const unsettled = await t
      .withIdentity(ALICE)
      .query(api.expenses.list, listArgs("unsettled"));
    expect(unsettled.page.map((row) => row.title)).toEqual(["未精算"]);

    const all = await t
      .withIdentity(ALICE)
      .query(api.expenses.list, listArgs("all"));
    expect(all.page.map((row) => row.title).sort()).toEqual([
      "未精算",
      "精算済み",
    ]);
    expect(all.page.find((row) => row.title === "精算済み")!.settled).toBe(true);
  });

  test("論理削除された支出はどちらのフィルタでも出さない", async () => {
    const t = convexTest(schema, modules);
    const members = await setupCouple(t);
    const expenseId = await t
      .withIdentity(ALICE)
      .mutation(api.expenses.save, manualArgs(members));
    await t.withIdentity(ALICE).mutation(api.expenses.remove, { expenseId });

    for (const filter of ["unsettled", "all"] as const) {
      const result = await t
        .withIdentity(ALICE)
        .query(api.expenses.list, listArgs(filter));
      expect(result.page).toHaveLength(0);
    }
  });

  test("ドラフトも一覧に含める(確定させる導線を残すため)", async () => {
    const t = convexTest(schema, modules);
    const members = await setupCouple(t);
    await t
      .withIdentity(ALICE)
      .mutation(api.expenses.save, manualArgs(members, { status: "draft" }));
    const result = await t
      .withIdentity(ALICE)
      .query(api.expenses.list, listArgs("unsettled"));
    expect(result.page[0].status).toBe("draft");
  });

  test("ページングで続きを読める", async () => {
    const t = convexTest(schema, modules);
    const members = await setupCouple(t);
    for (const offset of [-2, -1, 0]) {
      await t.withIdentity(ALICE).mutation(
        api.expenses.save,
        manualArgs(members, { purchasedAt: jstDate(offset) }),
      );
    }

    const first = await t
      .withIdentity(ALICE)
      .query(api.expenses.list, listArgs("unsettled", 2));
    expect(first.page).toHaveLength(2);
    expect(first.isDone).toBe(false);

    const second = await t
      .withIdentity(ALICE)
      .query(api.expenses.list, listArgs("unsettled", 2, first.continueCursor));
    expect(second.page).toHaveLength(1);
    expect(second.page[0].purchasedAt).toBe(jstDate(-2));
  });

  test("他世帯の支出は一覧に出ない", async () => {
    const t = convexTest(schema, modules);
    const members = await setupCouple(t);
    await t
      .withIdentity(ALICE)
      .mutation(api.expenses.save, manualArgs(members, { storeName: "自世帯" }));

    const other = await setupCouple(t, CAROL, identity("dave"));
    await t
      .withIdentity(CAROL)
      .mutation(api.expenses.save, manualArgs(other, { storeName: "他世帯" }));

    const result = await t
      .withIdentity(ALICE)
      .query(api.expenses.list, listArgs("all"));
    expect(result.page.map((row) => row.title)).toEqual(["自世帯"]);
  });

  test("未ログイン・世帯未所属では読めない", async () => {
    const t = convexTest(schema, modules);
    await setupCouple(t);
    await expect(
      t.query(api.expenses.list, listArgs("unsettled")),
    ).rejects.toThrow("ログインしてください");
    await expect(
      t.withIdentity(CAROL).query(api.expenses.list, listArgs("unsettled")),
    ).rejects.toThrow("世帯に参加してください");
  });
});

describe("expenses.get", () => {
  test("自世帯の支出を品目つきで返す", async () => {
    const t = convexTest(schema, modules);
    const members = await setupCouple(t);
    const expenseId = await t
      .withIdentity(ALICE)
      .mutation(api.expenses.save, manualArgs(members, { storeName: "焼肉屋" }));

    const expense = await t
      .withIdentity(BOB)
      .query(api.expenses.get, { expenseId });
    expect(expense).toMatchObject({
      _id: expenseId,
      storeName: "焼肉屋",
      totalAmount: 5000,
      paidBy: members.self._id,
      status: "confirmed",
      source: "manual",
      settled: false,
      hasImage: false,
    });
    expect(expense!.items[0].shares).toHaveLength(2);
  });

  test("精算済みは settled: true になる", async () => {
    const t = convexTest(schema, modules);
    const members = await setupCouple(t);
    const expenseId = await t
      .withIdentity(ALICE)
      .mutation(api.expenses.save, manualArgs(members));
    await markSettled(t, members, expenseId);
    const expense = await t
      .withIdentity(ALICE)
      .query(api.expenses.get, { expenseId });
    expect(expense!.settled).toBe(true);
  });

  test("他世帯・削除済み・不正なIDはすべて null", async () => {
    const t = convexTest(schema, modules);
    const members = await setupCouple(t);
    const expenseId = await t
      .withIdentity(ALICE)
      .mutation(api.expenses.save, manualArgs(members));
    const deletedId = await t
      .withIdentity(ALICE)
      .mutation(api.expenses.save, manualArgs(members));
    await t
      .withIdentity(ALICE)
      .mutation(api.expenses.remove, { expenseId: deletedId });

    await setupCouple(t, CAROL, identity("dave"));
    expect(
      await t.withIdentity(CAROL).query(api.expenses.get, { expenseId }),
    ).toBeNull();
    expect(
      await t
        .withIdentity(ALICE)
        .query(api.expenses.get, { expenseId: deletedId }),
    ).toBeNull();
    // URLに直接打たれた不正なIDでも引数検証エラーにせず「見つからない」を返す
    expect(
      await t
        .withIdentity(ALICE)
        .query(api.expenses.get, { expenseId: "not-an-id" }),
    ).toBeNull();
  });

  test("未ログイン・世帯未所属では読めない", async () => {
    const t = convexTest(schema, modules);
    const members = await setupCouple(t);
    const expenseId = await t
      .withIdentity(ALICE)
      .mutation(api.expenses.save, manualArgs(members));
    await expect(t.query(api.expenses.get, { expenseId })).rejects.toThrow(
      "ログインしてください",
    );
    await expect(
      t.withIdentity(CAROL).query(api.expenses.get, { expenseId }),
    ).rejects.toThrow("世帯に参加してください");
  });
});

describe("expenses.getImageUrl", () => {
  test("画像が無ければ null", async () => {
    const t = convexTest(schema, modules);
    const members = await setupCouple(t);
    const expenseId = await t
      .withIdentity(ALICE)
      .mutation(api.expenses.save, manualArgs(members));
    expect(
      await t.withIdentity(ALICE).query(api.expenses.getImageUrl, { expenseId }),
    ).toBeNull();
  });

  test("画像付きの支出はURLを返し、他世帯には返さない", async () => {
    const t = convexTest(schema, modules);
    const members = await setupCouple(t);
    const expenseId = await t
      .withIdentity(ALICE)
      .mutation(api.expenses.save, manualArgs(members));
    await t.run(async (ctx) => {
      const imageStorageId = await ctx.storage.store(
        new Blob(["receipt"], { type: "image/png" }),
      );
      await ctx.db.patch("expenses", expenseId, { imageStorageId });
    });

    expect(
      await t.withIdentity(BOB).query(api.expenses.getImageUrl, { expenseId }),
    ).toEqual(expect.any(String));

    await setupCouple(t, CAROL, identity("dave"));
    expect(
      await t.withIdentity(CAROL).query(api.expenses.getImageUrl, { expenseId }),
    ).toBeNull();
  });
});

describe("expenses.remove", () => {
  test("deletedAt を立てる論理削除で、ドキュメントは残る", async () => {
    const t = convexTest(schema, modules);
    const members = await setupCouple(t);
    const expenseId = await t
      .withIdentity(ALICE)
      .mutation(api.expenses.save, manualArgs(members));

    await t.withIdentity(BOB).mutation(api.expenses.remove, { expenseId });

    const expense = await t.run(async (ctx) => ctx.db.get("expenses", expenseId));
    expect(expense).not.toBeNull();
    expect(expense!.deletedAt).toEqual(expect.any(Number));
  });

  test("精算済みは削除できない", async () => {
    const t = convexTest(schema, modules);
    const members = await setupCouple(t);
    const expenseId = await t
      .withIdentity(ALICE)
      .mutation(api.expenses.save, manualArgs(members));
    await markSettled(t, members, expenseId);

    await expect(
      t.withIdentity(ALICE).mutation(api.expenses.remove, { expenseId }),
    ).rejects.toThrow("精算済みの支出は変更できません");
  });

  test("他世帯・削除済みの支出は削除できない", async () => {
    const t = convexTest(schema, modules);
    const members = await setupCouple(t);
    const expenseId = await t
      .withIdentity(ALICE)
      .mutation(api.expenses.save, manualArgs(members));

    await setupCouple(t, CAROL, identity("dave"));
    await expect(
      t.withIdentity(CAROL).mutation(api.expenses.remove, { expenseId }),
    ).rejects.toThrow("支出が見つかりません");

    await t.withIdentity(ALICE).mutation(api.expenses.remove, { expenseId });
    await expect(
      t.withIdentity(ALICE).mutation(api.expenses.remove, { expenseId }),
    ).rejects.toThrow("支出が見つかりません");
  });

  test("未ログイン・世帯未所属では削除できない", async () => {
    const t = convexTest(schema, modules);
    const members = await setupCouple(t);
    const expenseId = await t
      .withIdentity(ALICE)
      .mutation(api.expenses.save, manualArgs(members));
    await expect(t.mutation(api.expenses.remove, { expenseId })).rejects.toThrow(
      "ログインしてください",
    );
    await expect(
      t.withIdentity(CAROL).mutation(api.expenses.remove, { expenseId }),
    ).rejects.toThrow("世帯に参加してください");
  });
});
