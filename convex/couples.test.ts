/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { PURGE_BATCH_SIZE } from "./couples";
import { departMember } from "./lib/members";

const ROWS_SPANNING_THREE_PURGE_BATCHES = PURGE_BATCH_SIZE * 2 + 50;

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

const INVITATION_TTL_MS = 72 * 60 * 60 * 1000;

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
    const before = Date.now();
    const invitation = await setupCouple(t);
    const after = Date.now();

    expect(invitation.code).toMatch(/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$/);
    // 有効期限はちょうど72時間(単なる「未来」ではなく値を固定する)
    expect(invitation.expiresAt).toBeGreaterThanOrEqual(
      before + INVITATION_TTL_MS,
    );
    expect(invitation.expiresAt).toBeLessThanOrEqual(after + INVITATION_TTL_MS);

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

  test("世帯名は30文字まで許可し、31文字は拒否する", async () => {
    const t = convexTest(schema, modules);
    await t.withIdentity(ALICE).mutation(api.couples.createCouple, {
      displayName: "あきこ",
      coupleName: "あ".repeat(30),
    });
    const household = await t
      .withIdentity(ALICE)
      .query(api.couples.household, {});
    expect(household.coupleName).toBe("あ".repeat(30));

    await expect(
      t.withIdentity(BOB).mutation(api.couples.createCouple, {
        displayName: "ぼぶ",
        coupleName: "あ".repeat(31),
      }),
    ).rejects.toThrow("世帯名は30文字以内で入力してください");
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

  test("V-201: 期限ちょうどのコードは無効(期限は排他的)", async () => {
    const t = convexTest(schema, modules);
    const invitation = await setupCouple(t);
    const deadline = Date.now() + 60_000;
    await t.run(async (ctx) => {
      const row = await ctx.db
        .query("invitations")
        .withIndex("by_code", (q) => q.eq("code", invitation.code))
        .unique();
      await ctx.db.patch("invitations", row!._id, { expiresAt: deadline });
    });

    // 時刻を止めて 現在時刻 === expiresAt を作る。
    // 実時間のままだと判定が `<` でも通ってしまい、境界を固定できない
    vi.useFakeTimers();
    vi.setSystemTime(deadline);
    try {
      await expect(
        t.withIdentity(BOB).mutation(api.couples.joinCouple, {
          code: invitation.code,
          displayName: "ぼぶ",
        }),
      ).rejects.toThrow("招待コードが無効です");
    } finally {
      vi.useRealTimers();
    }
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

    // 旧コードの行は削除され、有効なコードが1件だけ残る
    const remaining = await t.run(async (ctx) => {
      return await ctx.db.query("invitations").take(10);
    });
    expect(remaining).toHaveLength(1);
    expect(remaining[0].code).toBe(second.code);

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

describe("leaveCouple", () => {
  test("未精算の確定支出があれば退出を拒否する", async () => {
    const t = convexTest(schema, modules);
    const invitation = await setupCouple(t);
    await t.withIdentity(BOB).mutation(api.couples.joinCouple, {
      code: invitation.code,
      displayName: "ぼぶ",
    });
    const household = await t
      .withIdentity(ALICE)
      .query(api.couples.household, {});

    await t.withIdentity(ALICE).mutation(api.expenses.save, {
      paidBy: household.self._id,
      purchasedAt: "2026-07-20",
      items: [
        {
          name: "食材",
          price: 1000,
          quantity: 1,
          shares: [
            { memberId: household.self._id, ratioPercent: 50 },
            { memberId: household.partner!._id, ratioPercent: 50 },
          ],
        },
      ],
      source: "manual",
      status: "confirmed",
    });
    expect(
      (await t.withIdentity(ALICE).query(api.couples.household, {})).leaveBlocker,
    ).toBe("unsettled");

    await expect(
      t.withIdentity(ALICE).mutation(api.couples.leaveCouple, {}),
    ).rejects.toThrow("未精算の支出があります。先に精算してから退出してください");
  });

  test("自分の下書きがあれば退出を拒否する", async () => {
    const t = convexTest(schema, modules);
    const invitation = await setupCouple(t);
    await t.withIdentity(BOB).mutation(api.couples.joinCouple, {
      code: invitation.code,
      displayName: "ぼぶ",
    });
    const household = await t
      .withIdentity(ALICE)
      .query(api.couples.household, {});

    await t.withIdentity(ALICE).mutation(api.expenses.save, {
      paidBy: household.self._id,
      purchasedAt: "2026-07-20",
      items: [
        {
          name: "食材",
          price: 1000,
          quantity: 1,
          shares: [{ memberId: household.self._id, ratioPercent: 100 }],
        },
      ],
      source: "manual",
      status: "draft",
    });

    await expect(
      t.withIdentity(ALICE).mutation(api.couples.leaveCouple, {}),
    ).rejects.toThrow("下書きの支出が残っています。確定するか削除してから退出してください");
  });

  test("パートナーの下書きがあれば退出を拒否する", async () => {
    const t = convexTest(schema, modules);
    const invitation = await setupCouple(t);
    await t.withIdentity(BOB).mutation(api.couples.joinCouple, {
      code: invitation.code,
      displayName: "ぼぶ",
    });
    const household = await t
      .withIdentity(ALICE)
      .query(api.couples.household, {});

    await t.withIdentity(BOB).mutation(api.expenses.save, {
      paidBy: household.partner!._id,
      purchasedAt: "2026-07-20",
      items: [
        {
          name: "日用品",
          price: 1000,
          quantity: 1,
          shares: [{ memberId: household.partner!._id, ratioPercent: 100 }],
        },
      ],
      source: "manual",
      status: "draft",
    });

    await expect(
      t.withIdentity(ALICE).mutation(api.couples.leaveCouple, {}),
    ).rejects.toThrow("下書きの支出が残っています。確定するか削除してから退出してください");
  });

  test("精算後は退出でき、履歴名を残したまま再参加を受け付ける", async () => {
    const t = convexTest(schema, modules);
    const invitation = await setupCouple(t);
    await t.withIdentity(BOB).mutation(api.couples.joinCouple, {
      code: invitation.code,
      displayName: "ぼぶ",
    });
    const household = await t
      .withIdentity(ALICE)
      .query(api.couples.household, {});
    const currentMember = await t
      .withIdentity(ALICE)
      .query(api.couples.currentMember, {});
    if (currentMember === null) {
      throw new Error("自分のメンバーが見つからない");
    }
    const coupleId = currentMember.coupleId;
    const expenseId = await t.withIdentity(ALICE).mutation(api.expenses.save, {
      paidBy: household.self._id,
      purchasedAt: "2026-07-20",
      items: [
        {
          name: "食材",
          price: 1000,
          quantity: 1,
          shares: [
            { memberId: household.self._id, ratioPercent: 50 },
            { memberId: household.partner!._id, ratioPercent: 50 },
          ],
        },
      ],
      source: "manual",
      status: "confirmed",
    });
    const balance = await t
      .withIdentity(ALICE)
      .query(api.settlements.currentBalance, {});
    const settlementId = await t
      .withIdentity(ALICE)
      .mutation(api.settlements.execute, {
        memo: undefined,
        expectedAmount: balance.amount,
        expectedFromMemberId: balance.fromMemberId,
        expectedExpenseCount: balance.expenseCount,
      });

    await t.withIdentity(ALICE).mutation(api.couples.leaveCouple, {});

    const members = await t.run(async (ctx) =>
      ctx.db
        .query("members")
        .withIndex("by_coupleId", (q) => q.eq("coupleId", coupleId))
        .collect(),
    );
    const departed = members.find((member) => member._id === household.self._id);
    expect(departed).toMatchObject({
      displayName: "あきこ",
      leftAt: expect.any(Number),
    });
    expect(departed?.tokenIdentifier).toBeUndefined();

    const bobHousehold = await t
      .withIdentity(BOB)
      .query(api.couples.household, {});
    expect(bobHousehold.partner).toBeNull();
    expect(bobHousehold.memberCount).toBe(1);
    expect(bobHousehold.leaveBlocker).toBeNull();

    const reissued = await t
      .withIdentity(BOB)
      .mutation(api.couples.reissueInvitation, {});
    await t.withIdentity(CAROL).mutation(api.couples.joinCouple, {
      code: reissued.code,
      displayName: "きゃろる",
    });

    const detail = await t.withIdentity(BOB).query(api.settlements.detail, {
      settlementId,
    });
    expect(detail.kind).toBe("found");
    if (detail.kind === "found") {
      expect(detail.detail.participants).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ displayName: "あきこ" }),
        ]),
      );
    }

    await expect(
      t.withIdentity(BOB).mutation(api.expenses.save, {
        paidBy: household.self._id,
        purchasedAt: "2026-07-21",
        items: [
          {
            name: "不正な支出",
            price: 100,
            quantity: 1,
            shares: [{ memberId: household.self._id, ratioPercent: 100 }],
          },
        ],
        source: "manual",
        status: "confirmed",
      }),
    ).rejects.toThrow("権限がありません");

    expect(
      await t.withIdentity(ALICE).query(api.couples.currentMember, {}),
    ).toBeNull();
    await expect(
      t.withIdentity(ALICE).query(api.couples.household, {}),
    ).rejects.toThrow("世帯に参加してください");
    await t
      .withIdentity(ALICE)
      .mutation(api.couples.createCouple, { displayName: "あきこ2" });
    expect(expenseId).toBeDefined();
  });

  test("最後のメンバー退出で世帯データとレシート画像をpurgeし、再実行しても安全", async () => {
    const t = convexTest(schema, modules);
    const invitation = await setupCouple(t);
    await t.withIdentity(BOB).mutation(api.couples.joinCouple, {
      code: invitation.code,
      displayName: "ぼぶ",
    });
    const household = await t
      .withIdentity(ALICE)
      .query(api.couples.household, {});
    const currentMember = await t
      .withIdentity(ALICE)
      .query(api.couples.currentMember, {});
    if (currentMember === null) {
      throw new Error("自分のメンバーが見つからない");
    }
    const coupleId = currentMember.coupleId;
    const storageId = await t.run(async (ctx) =>
      ctx.storage.store(new Blob(["receipt"], { type: "image/jpeg" })),
    );
    await t
      .withIdentity(ALICE)
      .mutation(api.uploads.registerUpload, { storageId });
    await t.withIdentity(ALICE).mutation(api.expenses.save, {
      paidBy: household.self._id,
      purchasedAt: "2026-07-20",
      items: [
        {
          name: "食材",
          price: 1000,
          quantity: 1,
          shares: [
            { memberId: household.self._id, ratioPercent: 50 },
            { memberId: household.partner!._id, ratioPercent: 50 },
          ],
        },
      ],
      source: "receipt",
      status: "confirmed",
      imageStorageId: storageId,
    });
    const balance = await t
      .withIdentity(ALICE)
      .query(api.settlements.currentBalance, {});
    await t.withIdentity(ALICE).mutation(api.settlements.execute, {
      memo: undefined,
      expectedAmount: balance.amount,
      expectedFromMemberId: balance.fromMemberId,
      expectedExpenseCount: balance.expenseCount,
    });

    vi.useFakeTimers();
    try {
      await t.withIdentity(BOB).mutation(api.couples.leaveCouple, {});
      await t.withIdentity(ALICE).mutation(api.couples.leaveCouple, {});
      await t.finishAllScheduledFunctions(vi.runAllTimers);
    } finally {
      vi.useRealTimers();
    }

    const afterPurge = await t.run(async (ctx) => {
      const [couple, expenses, uploads, settlements, invitations, members, storage] =
        await Promise.all([
          ctx.db.get("couples", coupleId),
          ctx.db
            .query("expenses")
            .withIndex("by_coupleId_and_purchasedAt", (q) =>
              q.eq("coupleId", coupleId),
            )
            .collect(),
          ctx.db
            .query("uploads")
            .withIndex("by_coupleId", (q) => q.eq("coupleId", coupleId))
            .collect(),
          ctx.db
            .query("settlements")
            .withIndex("by_coupleId", (q) => q.eq("coupleId", coupleId))
            .collect(),
          ctx.db
            .query("invitations")
            .withIndex("by_coupleId", (q) => q.eq("coupleId", coupleId))
            .collect(),
          ctx.db
            .query("members")
            .withIndex("by_coupleId", (q) => q.eq("coupleId", coupleId))
            .collect(),
          ctx.db.system.get("_storage", storageId),
        ]);
      return {
        couple,
        expenses,
        uploads,
        settlements,
        invitations,
        members,
        storage,
      };
    });
    expect(afterPurge.couple).toBeNull();
    expect(afterPurge.expenses).toHaveLength(0);
    expect(afterPurge.uploads).toHaveLength(0);
    expect(afterPurge.settlements).toHaveLength(0);
    expect(afterPurge.invitations).toHaveLength(0);
    expect(afterPurge.members).toHaveLength(0);
    expect(afterPurge.storage).toBeNull();

    await t.mutation(internal.couples.purgeCouple, {
      coupleId,
    });
    await t.mutation(internal.couples.purgeCouple, {
      coupleId,
    });
  });

  test("パートナーがいなければ未精算があっても退出でき、世帯ごと消える", async () => {
    const t = convexTest(schema, modules);
    await setupCouple(t);
    const self = await t.withIdentity(ALICE).query(api.couples.currentMember, {});
    if (self === null) {
      throw new Error("自分のメンバーが見つからない");
    }
    await t.withIdentity(ALICE).mutation(api.expenses.save, {
      paidBy: self._id,
      purchasedAt: "2026-07-20",
      items: [
        {
          name: "牛乳",
          price: 250,
          quantity: 1,
          shares: [{ memberId: self._id, ratioPercent: 100 }],
        },
      ],
      source: "manual",
      status: "confirmed",
    });
    const household = await t.withIdentity(ALICE).query(api.couples.household, {});
    expect(household.leaveBlocker).toBeNull();

    vi.useFakeTimers();
    try {
      await t.withIdentity(ALICE).mutation(api.couples.leaveCouple, {});
      await t.finishAllScheduledFunctions(vi.runAllTimers);
    } finally {
      vi.useRealTimers();
    }
    const couple = await t.run(async (ctx) => ctx.db.get("couples", self.coupleId));
    expect(couple).toBeNull();
    await expect(
      t.withIdentity(ALICE).query(api.couples.currentMember, {}),
    ).resolves.toBeNull();
  });

  test("purgeは1回の上限を超える行数でも再スケジュールで消し切る", async () => {
    const t = convexTest(schema, modules);
    await setupCouple(t);
    const self = await t.withIdentity(ALICE).query(api.couples.currentMember, {});
    if (self === null) {
      throw new Error("自分のメンバーが見つからない");
    }
    const coupleId = self.coupleId;
    await t.run(async (ctx) => {
      for (let i = 0; i < ROWS_SPANNING_THREE_PURGE_BATCHES; i++) {
        await ctx.db.insert("expenses", {
          coupleId,
          paidBy: self._id,
          purchasedAt: "2026-07-01",
          totalAmount: 100,
          items: [
            {
              name: `品目${i}`,
              price: 100,
              quantity: 1,
              shares: [{ memberId: self._id, ratioPercent: 100 }],
            },
          ],
          source: "manual",
          status: "confirmed",
          settlementId: undefined,
          deletedAt: i % 2 === 0 ? Date.now() : undefined,
        });
      }
    });
    await t.run(async (ctx) => {
      const row = await ctx.db.get("members", self._id);
      await departMember(ctx, row!);
    });

    vi.useFakeTimers();
    try {
      await t.mutation(internal.couples.purgeCouple, { coupleId });
      await t.finishAllScheduledFunctions(vi.runAllTimers);
    } finally {
      vi.useRealTimers();
    }

    const remaining = await t.run(async (ctx) => ({
      couple: await ctx.db.get("couples", coupleId),
      expenses: await ctx.db
        .query("expenses")
        .withIndex("by_coupleId_and_purchasedAt", (q) =>
          q.eq("coupleId", coupleId),
        )
        .collect(),
    }));
    expect(remaining.couple).toBeNull();
    expect(remaining.expenses).toHaveLength(0);
  });

  test("世帯に所属していないユーザーの退出はnullを返す", async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.withIdentity(DAVE).mutation(api.couples.leaveCouple, {}),
    ).resolves.toBeNull();
  });
});
