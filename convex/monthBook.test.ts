/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import type { StoredCategoryId } from "../lib/category";

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

type Members = {
  self: { _id: Id<"members">; displayName: string };
  partner: { _id: Id<"members">; displayName: string } | null;
  coupleId: Id<"couples">;
};

async function setupCouple(
  t: ReturnType<typeof convexTest>,
  owner = ALICE,
  joiner: typeof BOB | null = BOB,
): Promise<Members> {
  const invitation = await t
    .withIdentity(owner)
    .mutation(api.couples.createCouple, { displayName: "あきこ" });
  if (joiner !== null) {
    await t.withIdentity(joiner).mutation(api.couples.joinCouple, {
      code: invitation.code,
      displayName: "ぼぶ",
    });
  }
  const household = await t.withIdentity(owner).query(api.couples.household, {});
  const coupleId = await t.run(async (ctx) => {
    const self = await ctx.db.get("members", household.self._id);
    return self!.coupleId;
  });
  return { self: household.self, partner: household.partner, coupleId };
}

const split = (members: Members) => {
  if (members.partner === null) {
    return [{ memberId: members.self._id, ratioPercent: 100 }];
  }
  return [
    { memberId: members.self._id, ratioPercent: 50 },
    { memberId: members.partner._id, ratioPercent: 50 },
  ];
};

async function insertExpense(
  t: ReturnType<typeof convexTest>,
  members: Members,
  args: {
    paidBy?: Id<"members">;
    purchasedAt: string;
    price: number;
    status?: "draft" | "confirmed";
    category?: StoredCategoryId;
    settled?: boolean;
    deletedAt?: number;
    shares?: { memberId: Id<"members">; ratioPercent: number }[];
  },
) {
  return t.run(async (ctx) => {
    let settlementId: Id<"settlements"> | undefined;
    if (args.settled) {
      const partnerId = members.partner?._id ?? members.self._id;
      settlementId = await ctx.db.insert("settlements", {
        coupleId: members.coupleId,
        fromMemberId: partnerId,
        toMemberId: members.self._id,
        amount: 1,
        settledBy: members.self._id,
        expenseCount: 1,
      });
    }
    return ctx.db.insert("expenses", {
      coupleId: members.coupleId,
      paidBy: args.paidBy ?? members.self._id,
      purchasedAt: args.purchasedAt,
      totalAmount: args.price,
      items: [
        {
          name: "品目",
          price: args.price,
          quantity: 1,
          shares: args.shares ?? split(members),
        },
      ],
      source: "manual",
      status: args.status ?? "confirmed",
      ...(args.category === undefined ? {} : { category: args.category }),
      ...(settlementId === undefined ? {} : { settlementId }),
      ...(args.deletedAt === undefined ? {} : { deletedAt: args.deletedAt }),
    });
  });
}

describe("monthBook.month", () => {
  test("未ログインはログインしてください", async () => {
    const t = convexTest(schema, modules);
    await expect(t.query(api.monthBook.month, { month: "2026-08" })).rejects.toThrow(
      "ログインしてください",
    );
  });

  test("世帯未所属は世帯に参加してください", async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.withIdentity(ALICE).query(api.monthBook.month, { month: "2026-08" }),
    ).rejects.toThrow("世帯に参加してください");
  });

  test("YYYY-MM でない月と 2000〜2100 年の外は月の指定が正しくありません", async () => {
    const t = convexTest(schema, modules);
    await setupCouple(t);
    await expect(
      t.withIdentity(ALICE).query(api.monthBook.month, { month: "2026-13" }),
    ).rejects.toThrow("月の指定が正しくありません");
    await expect(
      t.withIdentity(ALICE).query(api.monthBook.month, { month: "0001-01" }),
    ).rejects.toThrow("月の指定が正しくありません");
    const edge = await t
      .withIdentity(ALICE)
      .query(api.monthBook.month, { month: "2000-01" });
    expect(edge).toMatchObject({
      kind: "exact",
      slice: { month: "2000-01", totalAmount: 0, confirmedCount: 0 },
    });
  });

  test("品目分類で月次集計し、支出分類の変更は継承品目だけを移す", async () => {
    const t = convexTest(schema, modules);
    const members = await setupCouple(t);
    if (members.partner === null) {
      throw new Error("パートナーが参加できていない");
    }
    const expenseId = await t.run(async (ctx) =>
      ctx.db.insert("expenses", {
        coupleId: members.coupleId,
        paidBy: members.self._id,
        purchasedAt: "2026-08-10",
        totalAmount: 500,
        category: "daily",
        items: [
          {
            name: "パン",
            price: 300,
            quantity: 1,
            category: "food",
            shares: split(members),
          },
          {
            name: "洗剤",
            price: 200,
            quantity: 1,
            shares: split(members),
          },
        ],
        source: "manual",
        status: "confirmed",
      }),
    );

    const before = await t
      .withIdentity(ALICE)
      .query(api.monthBook.month, { month: "2026-08" });
    expect(before).toMatchObject({
      kind: "exact",
      slice: {
        totalAmount: 500,
        categories: [
          { id: "food", label: "食費", amount: 300 },
          { id: "daily", label: "日用品", amount: 200 },
        ],
      },
    });

    await t.withIdentity(ALICE).mutation(api.expenses.setCategory, {
      expenseId,
      category: "other",
    });

    const after = await t
      .withIdentity(ALICE)
      .query(api.monthBook.month, { month: "2026-08" });
    expect(after).toMatchObject({
      kind: "exact",
      slice: {
        totalAmount: 500,
        categories: [
          { id: "food", label: "食費", amount: 300 },
          { id: "other", label: "その他", amount: 200 },
        ],
      },
    });
  });

  test("確定の食費と未分類、精算済み、下書き、削除、隣の月を分けて返す", async () => {
    const t = convexTest(schema, modules);
    const members = await setupCouple(t);
    if (members.partner === null) {
      throw new Error("パートナーが参加できていない");
    }
    await insertExpense(t, members, {
      purchasedAt: "2026-08-02",
      price: 5000,
      category: "food",
    });
    await insertExpense(t, members, {
      paidBy: members.partner._id,
      purchasedAt: "2026-08-03",
      price: 2000,
      settled: true,
    });
    await insertExpense(t, members, {
      purchasedAt: "2026-08-04",
      price: 999,
      status: "draft",
      category: "daily",
    });
    await insertExpense(t, members, {
      purchasedAt: "2026-08-05",
      price: 8000,
      deletedAt: 1,
    });
    await insertExpense(t, members, {
      purchasedAt: "2026-07-31",
      price: 4000,
    });

    await t
      .withIdentity(CAROL)
      .mutation(api.couples.createCouple, { displayName: "きゃろる" });
    const otherHousehold = await t
      .withIdentity(CAROL)
      .query(api.couples.household, {});
    const otherCoupleId = await t.run(async (ctx) => {
      const self = await ctx.db.get("members", otherHousehold.self._id);
      return self!.coupleId;
    });
    await t.run(async (ctx) => {
      await ctx.db.insert("expenses", {
        coupleId: otherCoupleId,
        paidBy: otherHousehold.self._id,
        purchasedAt: "2026-08-01",
        totalAmount: 3000,
        items: [
          {
            name: "他世帯",
            price: 3000,
            quantity: 1,
            shares: [{ memberId: otherHousehold.self._id, ratioPercent: 100 }],
          },
        ],
        source: "manual",
        status: "confirmed",
        category: "leisure",
      });
    });

    const result = await t
      .withIdentity(ALICE)
      .query(api.monthBook.month, { month: "2026-08" });

    expect(result).toEqual({
      kind: "exact",
      slice: {
        month: "2026-08",
        confirmedCount: 2,
        draftCount: 1,
        totalAmount: 7000,
        settledAmount: 2000,
        unsettledAmount: 5000,
        unsettledBalance: {
          fromMemberId: members.partner._id,
          toMemberId: members.self._id,
          amount: 2500,
        },
        members: [
          {
            memberId: members.self._id,
            displayName: "あきこ",
            isViewer: true,
            paidAmount: 5000,
            shareAmount: 3500,
          },
          {
            memberId: members.partner._id,
            displayName: "ぼぶ",
            isViewer: false,
            paidAmount: 2000,
            shareAmount: 3500,
          },
        ],
        categories: [
          { id: "food", label: "食費", amount: 5000 },
          { id: "uncategorized", label: "未分類", amount: 2000 },
        ],
      },
    });
  });

  test("支出が無い月は0円の exact で、カテゴリは空", async () => {
    const t = convexTest(schema, modules);
    const members = await setupCouple(t);
    if (members.partner === null) {
      throw new Error("パートナーが参加できていない");
    }
    const result = await t
      .withIdentity(ALICE)
      .query(api.monthBook.month, { month: "2026-09" });
    expect(result).toEqual({
      kind: "exact",
      slice: {
        month: "2026-09",
        confirmedCount: 0,
        draftCount: 0,
        totalAmount: 0,
        settledAmount: 0,
        unsettledAmount: 0,
        unsettledBalance: {
          fromMemberId: null,
          toMemberId: null,
          amount: 0,
        },
        members: [
          {
            memberId: members.self._id,
            displayName: "あきこ",
            isViewer: true,
            paidAmount: 0,
            shareAmount: 0,
          },
          {
            memberId: members.partner._id,
            displayName: "ぼぶ",
            isViewer: false,
            paidAmount: 0,
            shareAmount: 0,
          },
        ],
        categories: [],
      },
    });
  });

  test("パートナー未参加ならメンバーは自分だけ", async () => {
    const t = convexTest(schema, modules);
    const members = await setupCouple(t, ALICE, null);
    await insertExpense(t, members, {
      purchasedAt: "2026-08-01",
      price: 1000,
      category: "transport",
    });
    const result = await t
      .withIdentity(ALICE)
      .query(api.monthBook.month, { month: "2026-08" });
    expect(result).toEqual({
      kind: "exact",
      slice: {
        month: "2026-08",
        confirmedCount: 1,
        draftCount: 0,
        totalAmount: 1000,
        settledAmount: 0,
        unsettledAmount: 1000,
        unsettledBalance: {
          fromMemberId: null,
          toMemberId: null,
          amount: 0,
        },
        members: [
          {
            memberId: members.self._id,
            displayName: "あきこ",
            isViewer: true,
            paidAmount: 1000,
            shareAmount: 1000,
          },
        ],
        categories: [{ id: "transport", label: "交通", amount: 1000 }],
      },
    });
  });

  test("200件ちょうどは exact、201件目があると円合計を返さず overflow", async () => {
    const t = convexTest(schema, modules);
    const members = await setupCouple(t, ALICE, null);
    await t.run(async (ctx) => {
      for (let i = 0; i < 200; i++) {
        await ctx.db.insert("expenses", {
          coupleId: members.coupleId,
          paidBy: members.self._id,
          purchasedAt: `2026-01-${String((i % 28) + 1).padStart(2, "0")}`,
          totalAmount: 100,
          items: [
            {
              name: "食材",
              price: 100,
              quantity: 1,
              shares: [{ memberId: members.self._id, ratioPercent: 100 }],
            },
          ],
          source: "manual",
          status: "confirmed",
        });
      }
    });

    const exact = await t
      .withIdentity(ALICE)
      .query(api.monthBook.month, { month: "2026-01" });
    expect(exact.kind).toBe("exact");
    if (exact.kind !== "exact") {
      throw new Error("expected exact");
    }
    expect(exact.slice.confirmedCount).toBe(200);
    expect(exact.slice.totalAmount).toBe(20000);

    await t.run(async (ctx) => {
      await ctx.db.insert("expenses", {
        coupleId: members.coupleId,
        paidBy: members.self._id,
        purchasedAt: "2026-01-15",
        totalAmount: 100,
        items: [
          {
            name: "食材",
            price: 100,
            quantity: 1,
            shares: [{ memberId: members.self._id, ratioPercent: 100 }],
          },
        ],
        source: "manual",
        status: "confirmed",
      });
    });

    const overflow = await t
      .withIdentity(ALICE)
      .query(api.monthBook.month, { month: "2026-01" });
    expect(overflow).toEqual({
      kind: "overflow",
      month: "2026-01",
      limit: 200,
    });
  });

  test("スキーマは保存語彙以外の category を拒む", async () => {
    const t = convexTest(schema, modules);
    const members = await setupCouple(t, ALICE, null);
    await expect(
      t.run(async (ctx) => {
        await ctx.db.insert("expenses", {
          coupleId: members.coupleId,
          paidBy: members.self._id,
          purchasedAt: "2026-08-01",
          totalAmount: 100,
          items: [
            {
              name: "品目",
              price: 100,
              quantity: 1,
              shares: [{ memberId: members.self._id, ratioPercent: 100 }],
            },
          ],
          source: "manual",
          status: "confirmed",
          category: "nope" as StoredCategoryId,
        });
      }),
    ).rejects.toThrow("nope");
  });
});

describe("monthBook.categoryItems", () => {
  test("returns only the caller's household items in the requested category", async () => {
    const t = convexTest(schema, modules);
    const members = await setupCouple(t);
    const other = await setupCouple(t, CAROL, null);
    const expenseId = await t.run(async (ctx) =>
      ctx.db.insert("expenses", {
        coupleId: members.coupleId,
        paidBy: members.self._id,
        storeName: "スーパー",
        purchasedAt: "2026-08-10",
        totalAmount: 500,
        category: "daily",
        items: [
          {
            name: "パン",
            price: 300,
            quantity: 1,
            category: "food",
            shares: split(members),
          },
          {
            name: "洗剤",
            price: 200,
            quantity: 1,
            shares: split(members),
          },
        ],
        source: "manual",
        status: "confirmed",
      }),
    );
    await t.run(async (ctx) => {
      await ctx.db.insert("expenses", {
        coupleId: other.coupleId,
        paidBy: other.self._id,
        storeName: "他世帯",
        purchasedAt: "2026-08-09",
        totalAmount: 900,
        category: "food",
        items: [
          {
            name: "他世帯の食材",
            price: 900,
            quantity: 1,
            shares: split(other),
          },
        ],
        source: "manual",
        status: "confirmed",
      });
    });

    const result = await t.withIdentity(ALICE).query(
      api.monthBook.categoryItems,
      { month: "2026-08", category: "food" },
    );
    expect(result).toEqual({
      kind: "rows",
      rows: [
        {
          expenseId,
          expenseTitle: "スーパー",
          itemName: "パン",
          amount: 300,
          purchasedAt: "2026-08-10",
        },
      ],
      totalAmount: 300,
    });
  });

  test("rejects an unknown category with the boundary error", async () => {
    const t = convexTest(schema, modules);
    await setupCouple(t);
    await expect(
      t.withIdentity(ALICE).query(api.monthBook.categoryItems, {
        month: "2026-08",
        category: "groceries",
      }),
    ).rejects.toThrow("分類の指定が正しくありません");
  });

  test("uses the same 200 expense overflow limit as the month query", async () => {
    const t = convexTest(schema, modules);
    const members = await setupCouple(t, ALICE, null);
    await t.run(async (ctx) => {
      for (let i = 0; i < 201; i++) {
        await ctx.db.insert("expenses", {
          coupleId: members.coupleId,
          paidBy: members.self._id,
          purchasedAt: `2026-01-${String((i % 28) + 1).padStart(2, "0")}`,
          totalAmount: 100,
          items: [
            {
              name: "食材",
              price: 100,
              quantity: 1,
              shares: split(members),
            },
          ],
          source: "manual",
          status: "confirmed",
          category: "food",
        });
      }
    });

    const monthResult = await t.withIdentity(ALICE).query(api.monthBook.month, {
      month: "2026-01",
    });
    const categoryResult = await t
      .withIdentity(ALICE)
      .query(api.monthBook.categoryItems, {
        month: "2026-01",
        category: "food",
      });
    expect(monthResult).toEqual({
      kind: "overflow",
      month: "2026-01",
      limit: 200,
    });
    expect(categoryResult).toEqual({ kind: "overflow", limit: 200 });
  });
});
