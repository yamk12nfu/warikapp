/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const ISSUER = "https://clerk.test";
const identity = (name: string) => ({
  issuer: ISSUER,
  subject: name,
  tokenIdentifier: `${ISSUER}|${name}`,
});
const ALICE = identity("alice");
const CAROL = identity("carol");

async function createCouple(
  t: ReturnType<typeof convexTest>,
  owner: typeof ALICE | typeof CAROL = ALICE,
) {
  return t
    .withIdentity(owner)
    .mutation(api.couples.createCouple, { displayName: "あきこ" });
}

describe("budgets.forMonth", () => {
  test("前月から引き継ぎ、対象月の変更はその月以降に適用する", async () => {
    const t = convexTest(schema, modules);
    await createCouple(t);

    await t.withIdentity(ALICE).mutation(api.budgets.setForMonth, {
      month: "2026-07",
      overall: 100000,
      categories: [
        { category: "food", amount: 25000 },
        { category: "daily", amount: 12000 },
      ],
    });
    await t.withIdentity(ALICE).mutation(api.budgets.setForMonth, {
      month: "2026-07",
      overall: 100000,
      categories: [
        { category: "food", amount: 25000 },
        { category: "daily", amount: 12000 },
      ],
    });

    await expect(
      t.withIdentity(ALICE).query(api.budgets.forMonth, { month: "2026-09" }),
    ).resolves.toEqual({
      overall: 100000,
      categories: { food: 25000, daily: 12000 },
    });

    await t.withIdentity(ALICE).mutation(api.budgets.setForMonth, {
      month: "2026-09",
      overall: 80000,
      categories: [{ category: "food", amount: 40000 }],
    });

    await expect(
      t.withIdentity(ALICE).query(api.budgets.forMonth, { month: "2026-08" }),
    ).resolves.toEqual({
      overall: 100000,
      categories: { food: 25000, daily: 12000 },
    });
    await expect(
      t.withIdentity(ALICE).query(api.budgets.forMonth, { month: "2026-09" }),
    ).resolves.toEqual({
      overall: 80000,
      categories: { food: 40000, daily: 12000 },
    });

    const julyRows = await t.run(async (ctx) => {
      const member = await ctx.db
        .query("members")
        .withIndex("by_tokenIdentifier", (q) =>
          q.eq("tokenIdentifier", ALICE.tokenIdentifier),
        )
        .unique();
      return await ctx.db
        .query("budgets")
        .withIndex("by_coupleId_and_month", (q) =>
          q.eq("coupleId", member!.coupleId).eq("month", "2026-07"),
        )
        .collect();
    });
    expect(julyRows).toHaveLength(3);
  });

  test("null はその月から全体・分類別予算を解除する", async () => {
    const t = convexTest(schema, modules);
    await createCouple(t);
    await t.withIdentity(ALICE).mutation(api.budgets.setForMonth, {
      month: "2026-07",
      overall: 90000,
      categories: [{ category: "food", amount: 30000 }],
    });
    await t.withIdentity(ALICE).mutation(api.budgets.setForMonth, {
      month: "2026-09",
      overall: null,
      categories: [{ category: "food", amount: null }],
    });

    await expect(
      t.withIdentity(ALICE).query(api.budgets.forMonth, { month: "2026-08" }),
    ).resolves.toEqual({ overall: 90000, categories: { food: 30000 } });
    await expect(
      t.withIdentity(ALICE).query(api.budgets.forMonth, { month: "2026-09" }),
    ).resolves.toEqual({ overall: null, categories: {} });
  });

  test("別の世帯の予算を読めず、書き込みも別の世帯に分離される", async () => {
    const t = convexTest(schema, modules);
    await createCouple(t, ALICE);
    await createCouple(t, CAROL);
    await t.withIdentity(ALICE).mutation(api.budgets.setForMonth, {
      month: "2026-07",
      overall: 90000,
      categories: [{ category: "food", amount: 30000 }],
    });

    await expect(
      t.withIdentity(CAROL).query(api.budgets.forMonth, { month: "2026-09" }),
    ).resolves.toEqual({ overall: null, categories: {} });
    await t.withIdentity(CAROL).mutation(api.budgets.setForMonth, {
      month: "2026-09",
      overall: null,
      categories: [{ category: "food", amount: 50000 }],
    });
    await expect(
      t.withIdentity(ALICE).query(api.budgets.forMonth, { month: "2026-09" }),
    ).resolves.toEqual({ overall: 90000, categories: { food: 30000 } });
    await expect(
      t.withIdentity(CAROL).query(api.budgets.forMonth, { month: "2026-09" }),
    ).resolves.toEqual({ overall: null, categories: { food: 50000 } });
  });

  test.each([
    [-1, "負の金額"],
    [1.5, "小数"],
    [100000000, "上限超過"],
  ])("%s 円の%s予算を拒否する", async (amount) => {
    const t = convexTest(schema, modules);
    await createCouple(t);
    await expect(
      t.withIdentity(ALICE).mutation(api.budgets.setForMonth, {
        month: "2026-09",
        overall: amount,
        categories: [],
      }),
    ).rejects.toThrow("予算は0〜99,999,999円の整数で入力してください");
  });

  test("不正な月を拒否する", async () => {
    const t = convexTest(schema, modules);
    await createCouple(t);
    await expect(
      t.withIdentity(ALICE).query(api.budgets.forMonth, { month: "2026-13" }),
    ).rejects.toThrow("月の指定が正しくありません");
  });

  test("未認証の読み書きを拒否する", async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.query(api.budgets.forMonth, { month: "2026-09" }),
    ).rejects.toThrow("ログインしてください");
    await expect(
      t.mutation(api.budgets.setForMonth, {
        month: "2026-09",
        overall: null,
        categories: [],
      }),
    ).rejects.toThrow("ログインしてください");
  });
});
