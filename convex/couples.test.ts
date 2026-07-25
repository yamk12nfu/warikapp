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
const BOB = identity("bob");
const CAROL = identity("carol");

// 世帯を1つ作り、招待コードを返す
async function setupCouple(
  t: ReturnType<typeof convexTest>,
  who = ALICE,
  displayName = "あきこ",
) {
  return await t
    .withIdentity(who)
    .mutation(api.couples.createCouple, { displayName });
}

describe("createCouple", () => {
  test("世帯とメンバーを作り、招待コードを発行する", async () => {
    const t = convexTest(schema, modules);
    const invitation = await setupCouple(t);

    expect(invitation.code).toMatch(/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$/);
    expect(invitation.expiresAt).toBeGreaterThan(Date.now());

    const household = await t
      .withIdentity(ALICE)
      .query(api.couples.household, {});
    expect(household.coupleName).toBe("わたしたち"); // 省略時のデフォルト
    expect(household.self.displayName).toBe("あきこ");
    expect(household.partner).toBeNull();
    expect(household.memberCount).toBe(1);
    expect(household.invitation?.code).toBe(invitation.code);
  });

  test("世帯名を指定でき、表示名は前後の空白を除去する", async () => {
    const t = convexTest(schema, modules);
    await t.withIdentity(ALICE).mutation(api.couples.createCouple, {
      displayName: "  あきこ  ",
      coupleName: "あき家",
    });

    const household = await t
      .withIdentity(ALICE)
      .query(api.couples.household, {});
    expect(household.coupleName).toBe("あき家");
    expect(household.self.displayName).toBe("あきこ");
  });

  test("未ログインでは作成できない", async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.mutation(api.couples.createCouple, { displayName: "あきこ" }),
    ).rejects.toThrow("ログインしてください");
  });

  test("表示名が空・21文字以上なら拒否する", async () => {
    const t = convexTest(schema, modules);
    await expect(
      t
        .withIdentity(ALICE)
        .mutation(api.couples.createCouple, { displayName: "   " }),
    ).rejects.toThrow("表示名は1〜20文字で入力してください");
    await expect(
      t
        .withIdentity(ALICE)
        .mutation(api.couples.createCouple, { displayName: "あ".repeat(21) }),
    ).rejects.toThrow("表示名は1〜20文字で入力してください");
  });

  test("V-202: すでに世帯所属なら作成できない", async () => {
    const t = convexTest(schema, modules);
    await setupCouple(t);
    await expect(
      t
        .withIdentity(ALICE)
        .mutation(api.couples.createCouple, { displayName: "あきこ" }),
    ).rejects.toThrow("すでに世帯に参加しています");
  });
});

describe("joinCouple", () => {
  test("招待コードで参加でき、両者が同じ世帯を見る", async () => {
    const t = convexTest(schema, modules);
    const invitation = await setupCouple(t);

    await t.withIdentity(BOB).mutation(api.couples.joinCouple, {
      code: invitation.code,
      displayName: "ぼぶ",
    });

    const alice = await t.withIdentity(ALICE).query(api.couples.household, {});
    const bob = await t.withIdentity(BOB).query(api.couples.household, {});
    expect(alice.memberCount).toBe(2);
    expect(alice.partner?.displayName).toBe("ぼぶ");
    expect(bob.partner?.displayName).toBe("あきこ");
    // 満員になったら招待コードは出さない
    expect(alice.invitation).toBeNull();

    const aliceMember = await t
      .withIdentity(ALICE)
      .query(api.couples.currentMember, {});
    const bobMember = await t
      .withIdentity(BOB)
      .query(api.couples.currentMember, {});
    expect(aliceMember?.coupleId).toBe(bobMember?.coupleId);
  });

  test("小文字・前後の空白を含むコードでも参加できる", async () => {
    const t = convexTest(schema, modules);
    const invitation = await setupCouple(t);

    await t.withIdentity(BOB).mutation(api.couples.joinCouple, {
      code: ` ${invitation.code.toLowerCase()} `,
      displayName: "ぼぶ",
    });

    const bob = await t.withIdentity(BOB).query(api.couples.household, {});
    expect(bob.memberCount).toBe(2);
  });

  test("V-201: 存在しないコードは無効", async () => {
    const t = convexTest(schema, modules);
    await setupCouple(t);
    await expect(
      t
        .withIdentity(BOB)
        .mutation(api.couples.joinCouple, {
          code: "ZZZZZZZZ",
          displayName: "ぼぶ",
        }),
    ).rejects.toThrow("招待コードが無効です");
  });

  test("V-201: 使用済みコードは無効", async () => {
    const t = convexTest(schema, modules);
    const invitation = await setupCouple(t);
    await t.withIdentity(BOB).mutation(api.couples.joinCouple, {
      code: invitation.code,
      displayName: "ぼぶ",
    });

    await expect(
      t.withIdentity(CAROL).mutation(api.couples.joinCouple, {
        code: invitation.code,
        displayName: "きゃろる",
      }),
    ).rejects.toThrow("招待コードが無効です");
  });

  test("V-201: 期限切れコードは無効", async () => {
    const t = convexTest(schema, modules);
    const invitation = await setupCouple(t);
    await t.run(async (ctx) => {
      const row = await ctx.db
        .query("invitations")
        .withIndex("by_code", (q) => q.eq("code", invitation.code))
        .unique();
      await ctx.db.patch("invitations", row!._id, {
        expiresAt: Date.now() - 1000,
      });
    });

    await expect(
      t.withIdentity(BOB).mutation(api.couples.joinCouple, {
        code: invitation.code,
        displayName: "ぼぶ",
      }),
    ).rejects.toThrow("招待コードが無効です");
  });

  test("V-202: すでに世帯所属なら参加できない", async () => {
    const t = convexTest(schema, modules);
    const invitation = await setupCouple(t);
    await t
      .withIdentity(BOB)
      .mutation(api.couples.createCouple, { displayName: "ぼぶ" });

    await expect(
      t.withIdentity(BOB).mutation(api.couples.joinCouple, {
        code: invitation.code,
        displayName: "ぼぶ",
      }),
    ).rejects.toThrow("すでに世帯に参加しています");
  });

  test("V-203: 満員の世帯には参加できない(有効なコードが残っていても)", async () => {
    const t = convexTest(schema, modules);
    const invitation = await setupCouple(t);
    await t.withIdentity(BOB).mutation(api.couples.joinCouple, {
      code: invitation.code,
      displayName: "ぼぶ",
    });

    // 満員の世帯に未使用コードが残っている状況を作る(多重防御の確認)
    const extraCode = "TESTCODE";
    await t.run(async (ctx) => {
      const member = await ctx.db
        .query("members")
        .withIndex("by_tokenIdentifier", (q) =>
          q.eq("tokenIdentifier", ALICE.tokenIdentifier),
        )
        .unique();
      await ctx.db.insert("invitations", {
        coupleId: member!.coupleId,
        code: extraCode,
        expiresAt: Date.now() + 60_000,
      });
    });

    await expect(
      t.withIdentity(CAROL).mutation(api.couples.joinCouple, {
        code: extraCode,
        displayName: "きゃろる",
      }),
    ).rejects.toThrow("この世帯は満員です");
  });
});

describe("世帯間のデータ分離", () => {
  test("別世帯のメンバーには相手世帯の情報が一切見えない", async () => {
    const t = convexTest(schema, modules);
    const invitation = await setupCouple(t);
    await t.withIdentity(BOB).mutation(api.couples.joinCouple, {
      code: invitation.code,
      displayName: "ぼぶ",
    });
    await t.withIdentity(CAROL).mutation(api.couples.createCouple, {
      displayName: "きゃろる",
      coupleName: "きゃろる家",
    });

    const carol = await t.withIdentity(CAROL).query(api.couples.household, {});
    expect(carol.coupleName).toBe("きゃろる家");
    expect(carol.memberCount).toBe(1);
    expect(carol.partner).toBeNull();

    const carolMember = await t
      .withIdentity(CAROL)
      .query(api.couples.currentMember, {});
    const aliceMember = await t
      .withIdentity(ALICE)
      .query(api.couples.currentMember, {});
    expect(carolMember?.coupleId).not.toBe(aliceMember?.coupleId);
  });

  test("世帯未所属では household を読めない", async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.withIdentity(CAROL).query(api.couples.household, {}),
    ).rejects.toThrow("世帯に参加してください");
  });

  test("未ログインでは household を読めず、currentMember は null を返す", async () => {
    const t = convexTest(schema, modules);
    await expect(t.query(api.couples.household, {})).rejects.toThrow(
      "ログインしてください",
    );
    expect(await t.query(api.couples.currentMember, {})).toBeNull();
  });
});

describe("updateDisplayName", () => {
  test("自分の表示名だけを変更する", async () => {
    const t = convexTest(schema, modules);
    const invitation = await setupCouple(t);
    await t.withIdentity(BOB).mutation(api.couples.joinCouple, {
      code: invitation.code,
      displayName: "ぼぶ",
    });

    await t
      .withIdentity(BOB)
      .mutation(api.couples.updateDisplayName, { displayName: "ぼぶ太郎" });

    const alice = await t.withIdentity(ALICE).query(api.couples.household, {});
    expect(alice.self.displayName).toBe("あきこ");
    expect(alice.partner?.displayName).toBe("ぼぶ太郎");
  });

  test("21文字以上は拒否する", async () => {
    const t = convexTest(schema, modules);
    await setupCouple(t);
    await expect(
      t
        .withIdentity(ALICE)
        .mutation(api.couples.updateDisplayName, {
          displayName: "あ".repeat(21),
        }),
    ).rejects.toThrow("表示名は1〜20文字で入力してください");
  });
});

describe("reissueInvitation", () => {
  test("再発行すると旧コードは使えなくなり、新コードで参加できる", async () => {
    const t = convexTest(schema, modules);
    const first = await setupCouple(t);
    const second = await t
      .withIdentity(ALICE)
      .mutation(api.couples.reissueInvitation, {});

    expect(second.code).not.toBe(first.code);

    await expect(
      t.withIdentity(BOB).mutation(api.couples.joinCouple, {
        code: first.code,
        displayName: "ぼぶ",
      }),
    ).rejects.toThrow("招待コードが無効です");

    await t.withIdentity(BOB).mutation(api.couples.joinCouple, {
      code: second.code,
      displayName: "ぼぶ",
    });
    const bob = await t.withIdentity(BOB).query(api.couples.household, {});
    expect(bob.memberCount).toBe(2);
  });

  test("満員の世帯では再発行できない", async () => {
    const t = convexTest(schema, modules);
    const invitation = await setupCouple(t);
    await t.withIdentity(BOB).mutation(api.couples.joinCouple, {
      code: invitation.code,
      displayName: "ぼぶ",
    });

    await expect(
      t.withIdentity(ALICE).mutation(api.couples.reissueInvitation, {}),
    ).rejects.toThrow("この世帯は満員です");
  });

  test("世帯未所属では再発行できない", async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.withIdentity(CAROL).mutation(api.couples.reissueInvitation, {}),
    ).rejects.toThrow("世帯に参加してください");
  });
});
