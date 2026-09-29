/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test, vi } from "vitest";
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

describe("export.csv 支出", () => {
  test("200件を超える支出を全件出し、別世帯・期間外・論理削除を除外する", async () => {
    const t = convexTest(schema, modules);
    const members = await setupCouple(t);
    const otherMembers = await setupCouple(t, CAROL, DAVE);

    await t.run(async (ctx) => {
      const ownMember = await ctx.db.get("members", members.self._id);
      const otherMember = await ctx.db.get("members", otherMembers.self._id);
      if (ownMember === null || otherMember === null) {
        throw new Error("テスト用メンバーが見つからない");
      }

      for (let index = 0; index < 500; index += 1) {
        await ctx.db.insert("expenses", {
          coupleId: ownMember.coupleId,
          paidBy: members.self._id,
          purchasedAt: "2026-02-03",
          totalAmount: 300,
          items: [
            {
              name: `対象-${index}-A`,
              price: 100,
              quantity: 1,
              shares: [
                { memberId: members.self._id, ratioPercent: 50 },
                { memberId: members.partner._id, ratioPercent: 50 },
              ],
            },
            {
              name: `対象-${index}-B`,
              price: 200,
              quantity: 1,
              shares: [
                { memberId: members.self._id, ratioPercent: 50 },
                { memberId: members.partner._id, ratioPercent: 50 },
              ],
            },
          ],
          source: "manual",
          status: "confirmed",
        });
      }

      await ctx.db.insert("expenses", {
        coupleId: ownMember.coupleId,
        paidBy: members.self._id,
        storeName: "期間外店",
        purchasedAt: "2025-12-31",
        totalAmount: 100,
        items: [
          {
            name: "期間外品",
            price: 100,
            quantity: 1,
            shares: [{ memberId: members.self._id, ratioPercent: 100 }],
          },
        ],
        source: "manual",
        status: "confirmed",
      });
      await ctx.db.insert("expenses", {
        coupleId: ownMember.coupleId,
        paidBy: members.self._id,
        storeName: "削除済み店",
        purchasedAt: "2026-02-03",
        totalAmount: 100,
        items: [
          {
            name: "削除済み品",
            price: 100,
            quantity: 1,
            shares: [{ memberId: members.self._id, ratioPercent: 100 }],
          },
        ],
        source: "manual",
        status: "confirmed",
        deletedAt: Date.parse("2026-02-04T00:00:00.000Z"),
      });
      await ctx.db.insert("expenses", {
        coupleId: otherMember.coupleId,
        paidBy: otherMembers.self._id,
        storeName: "別世帯店",
        purchasedAt: "2026-02-03",
        totalAmount: 100,
        items: [
          {
            name: "別世帯品",
            price: 100,
            quantity: 1,
            shares: [{ memberId: otherMembers.self._id, ratioPercent: 100 }],
          },
        ],
        source: "manual",
        status: "confirmed",
      });
    });

    const result = await t.withIdentity(ALICE).action(api.export.csv, {
      kind: "expenses",
      from: "2026-01-01",
      to: "2026-12-31",
    });
    const lines = result.csv.split("\r\n").filter((line) => line.length > 0);

    expect(result.filename).toBe(
      "warikapp-支出-2026-01-01_2026-12-31.csv",
    );
    expect(lines).toHaveLength(1001);
    expect(lines[0]).toBe(
      "\uFEFF支出ID,購入日,店名,支払者,分類,支出合計,状態,精算ID,入力元,品目名,品目金額,数量,品目分類,負担割合",
    );
    expect(result.csv).toContain("対象-0-A");
    expect(result.csv).toContain("対象-499-B");
    expect(result.csv).not.toContain("別世帯店");
    expect(result.csv).not.toContain("期間外店");
    expect(result.csv).not.toContain("削除済み店");
  });

  test("公開 API で作成した支出の全列をCSVに出力する", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-04T03:30:00+09:00"));
    try {
      const t = convexTest(schema, modules);
      const members = await setupCouple(t);
      const expenseId = await t.withIdentity(ALICE).mutation(
        api.expenses.save,
        {
          paidBy: members.self._id,
          storeName: "青果店",
          purchasedAt: "2026-02-03",
          items: [
            {
              name: "りんご",
              price: 500,
              quantity: 2,
              category: "daily",
              shares: [
                { memberId: members.self._id, ratioPercent: 50 },
                { memberId: members.partner._id, ratioPercent: 50 },
              ],
            },
          ],
          source: "receipt",
          status: "draft",
          category: "food",
        },
      );

      const result = await t.withIdentity(ALICE).action(api.export.csv, {
        kind: "expenses",
        from: "2026-02-03",
        to: "2026-02-03",
      });

      expect(result.csv.split("\r\n").filter(Boolean)).toEqual([
        "\uFEFF支出ID,購入日,店名,支払者,分類,支出合計,状態,精算ID,入力元,品目名,品目金額,数量,品目分類,負担割合",
        `${expenseId},2026-02-03,青果店,あきこ,食費,1000,下書き,,レシート,りんご,1000,2,日用品,あきこ 50% / ぼぶ 50%`,
      ]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("export.csv 精算", () => {
  test("公開 API で作成した精算の全列をJSTで出力する", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-04T03:30:00+09:00"));
    try {
      const t = convexTest(schema, modules);
      const members = await setupCouple(t);
      await t.withIdentity(ALICE).mutation(api.expenses.save, {
        paidBy: members.self._id,
        purchasedAt: "2026-02-03",
        items: [
          {
            name: "コーヒー",
            price: 2000,
            quantity: 1,
            shares: [
              { memberId: members.self._id, ratioPercent: 50 },
              { memberId: members.partner._id, ratioPercent: 50 },
            ],
          },
        ],
        source: "manual",
        status: "confirmed",
      });
      const balance = await t
        .withIdentity(ALICE)
        .query(api.settlements.currentBalance, {});
      const started = await t.withIdentity(ALICE).mutation(api.settlements.start, {
        memo: "2月分",
        expectedAmount: balance.amount,
        expectedFromMemberId: balance.fromMemberId,
        expectedExpenseCount: balance.expenseCount,
      });
      await t.withIdentity(BOB).mutation(api.settlements.confirm, {
        settlementId: started.settlementId,
      });

      const result = await t.withIdentity(ALICE).action(api.export.csv, {
        kind: "settlements",
        from: "2026-02-04",
        to: "2026-02-04",
      });

      expect(result.filename).toBe(
        "warikapp-精算-2026-02-04_2026-02-04.csv",
      );
      expect(result.csv.split("\r\n").filter(Boolean)).toEqual([
        "\uFEFF精算ID,開始日時,状態,支払う側,受け取る側,金額,対象件数,開始した人,確認した人,確認日時,メモ",
        `${started.settlementId},2026-02-04 03:30,完了,ぼぶ,あきこ,1000,1,あきこ,ぼぶ,2026-02-04 03:30,2月分`,
      ]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("export.csv 認証と日付", () => {
  test("未ログインと世帯未所属を拒否する", async () => {
    const t = convexTest(schema, modules);
    const args = {
      kind: "expenses" as const,
      from: "2026-01-01",
      to: "2026-12-31",
    };

    await expect(t.action(api.export.csv, args)).rejects.toThrow(
      "ログインしてください",
    );
    await expect(
      t.withIdentity(CAROL).action(api.export.csv, args),
    ).rejects.toThrow("世帯に参加してください");
  });

  test("日付形式の誤りと開始日が終了日より後の場合を拒否する", async () => {
    const t = convexTest(schema, modules);
    await setupCouple(t);

    await expect(
      t.withIdentity(ALICE).action(api.export.csv, {
        kind: "expenses",
        from: "2026-02-31",
        to: "2026-03-01",
      }),
    ).rejects.toThrow("期間の日付を正しく入力してください");
    await expect(
      t.withIdentity(ALICE).action(api.export.csv, {
        kind: "expenses",
        from: "2026-03-02",
        to: "2026-03-01",
      }),
    ).rejects.toThrow("開始日は終了日以前の日付を指定してください");
  });
});
