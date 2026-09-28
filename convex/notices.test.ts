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

async function setup(t: ReturnType<typeof convexTest>) {
  const invitation = await t
    .withIdentity(ALICE)
    .mutation(api.couples.createCouple, { displayName: "あきこ" });
  await t.withIdentity(BOB).mutation(api.couples.joinCouple, {
    code: invitation.code,
    displayName: "ぼぶ",
  });
  const household = await t.withIdentity(ALICE).query(api.couples.household, {});
  const coupleId = await t.run(async (ctx) => {
    const self = await ctx.db.get("members", household.self._id);
    return self!.coupleId;
  });
  return { coupleId, self: household.self, partner: household.partner! };
}

async function insertNotice(
  t: ReturnType<typeof convexTest>,
  input: {
    coupleId: Id<"couples">;
    recipientId: Id<"members">;
    actorId: Id<"members">;
    amount: number;
  },
) {
  return await t.run(async (ctx) =>
    ctx.db.insert("notices", {
      ...input,
      kind: "settlementRejected",
      expenseCount: 2,
    }),
  );
}

describe("notices", () => {
  test("mine は受け手のお知らせを表示名付きで返す", async () => {
    const t = convexTest(schema, modules);
    const members = await setup(t);
    await insertNotice(t, {
      coupleId: members.coupleId,
      recipientId: members.self._id,
      actorId: members.partner._id,
      amount: 1500,
    });

    const notices = await t.withIdentity(ALICE).query(api.notices.mine, {});

    expect(notices[0]).toMatchObject({
      kind: "settlementRejected",
      actorName: "ぼぶ",
      amount: 1500,
      expenseCount: 2,
    });
  });

  test("dismiss 後 mine は空", async () => {
    const t = convexTest(schema, modules);
    const members = await setup(t);
    const noticeId = await insertNotice(t, {
      coupleId: members.coupleId,
      recipientId: members.self._id,
      actorId: members.partner._id,
      amount: 1500,
    });

    await t.withIdentity(ALICE).mutation(api.notices.dismiss, { noticeId });

    expect(
      await t.withIdentity(ALICE).query(api.notices.mine, {}),
    ).toEqual([]);
  });

  test("受け手以外の dismiss はお知らせが見つかりません", async () => {
    const t = convexTest(schema, modules);
    const members = await setup(t);
    const noticeId = await insertNotice(t, {
      coupleId: members.coupleId,
      recipientId: members.self._id,
      actorId: members.partner._id,
      amount: 1500,
    });

    await expect(
      t.withIdentity(BOB).mutation(api.notices.dismiss, { noticeId }),
    ).rejects.toThrow("お知らせが見つかりません");
  });

  test("mine は新しい5件を返す", async () => {
    const t = convexTest(schema, modules);
    const members = await setup(t);
    for (let amount = 1; amount <= 6; amount += 1) {
      await insertNotice(t, {
        coupleId: members.coupleId,
        recipientId: members.self._id,
        actorId: members.partner._id,
        amount,
      });
    }

    const notices = await t.withIdentity(ALICE).query(api.notices.mine, {});

    expect(notices).toHaveLength(5);
  });

  test("差し戻しを6回行っても通知は5件まで", async () => {
    const t = convexTest(schema, modules);
    const members = await setup(t);
    for (let index = 0; index < 6; index += 1) {
      await t.withIdentity(ALICE).mutation(api.expenses.save, {
        paidBy: members.self._id,
        purchasedAt: "2026-01-01",
        items: [
          {
            name: "食材",
            price: 5000,
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
        expectedAmount: balance.amount,
        expectedFromMemberId: balance.fromMemberId,
        expectedExpenseCount: balance.expenseCount,
      });
      await t.withIdentity(BOB).mutation(api.settlements.release, {
        settlementId: started.settlementId,
      });
    }

    const notices = await t.withIdentity(ALICE).query(api.notices.mine, {});

    expect(notices).toHaveLength(5);
  });
});
