/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
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

// レート制限はコンポーネント(別テーブル)なのでテストにも登録が要る
function setup() {
  const t = convexTest(schema, modules);
  rateLimiterTest.register(t);
  return t;
}

// 2名の世帯を作る(招待コードで参加させる本来の経路を通す)
async function setupCouple(
  t: ReturnType<typeof convexTest>,
  owner = ALICE,
  joiner = BOB,
) {
  const invitation = await t
    .withIdentity(owner)
    .mutation(api.couples.createCouple, { displayName: "あきこ" });
  await t.withIdentity(joiner).mutation(api.couples.joinCouple, {
    code: invitation.code,
    displayName: "ぼぶ",
  });
}

// Convex File Storage に画像を1件置き、その storageId を返す
async function storeImage(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    return await ctx.storage.store(
      new Blob([new Uint8Array([1, 2, 3])], { type: "image/jpeg" }),
    );
  });
}

describe("uploads.generateUploadUrl", () => {
  test("世帯メンバーはアップロードURLを取得できる", async () => {
    const t = setup();
    await setupCouple(t);
    const url = await t
      .withIdentity(ALICE)
      .mutation(api.uploads.generateUploadUrl, {});
    expect(typeof url).toBe("string");
  });

  test("未ログインでは取得できない", async () => {
    const t = setup();
    await expect(
      t.mutation(api.uploads.generateUploadUrl, {}),
    ).rejects.toThrow("ログインしてください");
  });

  test("世帯未所属では取得できない", async () => {
    const t = setup();
    await expect(
      t.withIdentity(CAROL).mutation(api.uploads.generateUploadUrl, {}),
    ).rejects.toThrow("世帯に参加してください");
  });

  // 読み取り(receipts.parse)を呼ばずにURL発行だけを繰り返せば、読み取りの
  // 回数制限を迂回して無制限にファイルを置けてしまうので、ここにも枠を掛ける
  test("世帯あたり60回/時を超えると断られる", async () => {
    const t = setup();
    await setupCouple(t);
    for (let count = 0; count < 60; count += 1) {
      await t.withIdentity(ALICE).mutation(api.uploads.generateUploadUrl, {});
    }
    // 61回目は同じ世帯の別メンバーから呼んでも断られる(世帯単位の制限)
    await expect(
      t.withIdentity(BOB).mutation(api.uploads.generateUploadUrl, {}),
    ).rejects.toThrow("アップロードの回数制限に達しました");
  });
});

describe("uploads.discard", () => {
  test("支出に紐付いていない画像は消せる", async () => {
    const t = setup();
    await setupCouple(t);
    const storageId = await storeImage(t);
    await t
      .withIdentity(ALICE)
      .mutation(api.uploads.registerUpload, { storageId });

    await t.withIdentity(ALICE).mutation(api.uploads.discard, { storageId });

    const rows = await t.run(async (ctx) => ctx.db.query("uploads").collect());
    expect(rows).toHaveLength(0);
    // 画像の実体も消える(置き去りのファイルを残さない)
    expect(
      await t.run(async (ctx) => ctx.db.system.get("_storage", storageId)),
    ).toBeNull();
  });

  test("支出に紐付いている画像は消さない", async () => {
    const t = setup();
    await setupCouple(t);
    const storageId = await storeImage(t);
    await t
      .withIdentity(ALICE)
      .mutation(api.uploads.registerUpload, { storageId });

    const household = await t
      .withIdentity(ALICE)
      .query(api.couples.household, {});
    await t.withIdentity(ALICE).mutation(api.expenses.save, {
      paidBy: household.self._id,
      purchasedAt: "2026-07-20",
      items: [
        {
          name: "牛肉",
          price: 500,
          quantity: 1,
          shares: [{ memberId: household.self._id, ratioPercent: 100 }],
        },
      ],
      source: "receipt",
      status: "draft",
      imageStorageId: storageId,
    });

    await t.withIdentity(ALICE).mutation(api.uploads.discard, { storageId });

    const rows = await t.run(async (ctx) => ctx.db.query("uploads").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0].usedByExpenseId).toBeTruthy();
  });

  test("他世帯の画像は消せない", async () => {
    const t = setup();
    await setupCouple(t);
    const storageId = await storeImage(t);
    await t
      .withIdentity(ALICE)
      .mutation(api.uploads.registerUpload, { storageId });

    await t
      .withIdentity(CAROL)
      .mutation(api.couples.createCouple, { displayName: "きゃろる" });

    await expect(
      t.withIdentity(CAROL).mutation(api.uploads.discard, { storageId }),
    ).rejects.toThrow("この画像は利用できません");
  });
});

describe("uploads.registerUpload", () => {
  test("自世帯のものとして台帳に記録され、同じIDの再登録は何もしない", async () => {
    const t = setup();
    await setupCouple(t);
    const storageId = await storeImage(t);

    await t
      .withIdentity(ALICE)
      .mutation(api.uploads.registerUpload, { storageId });
    // 再送信(通信のリトライ)で壊れないこと
    await t
      .withIdentity(ALICE)
      .mutation(api.uploads.registerUpload, { storageId });

    const rows = await t.run(async (ctx) => ctx.db.query("uploads").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0].storageId).toBe(storageId);
  });

  test("同世帯のパートナーが登録したIDも自世帯のものとして扱える", async () => {
    const t = setup();
    await setupCouple(t);
    const storageId = await storeImage(t);

    await t
      .withIdentity(ALICE)
      .mutation(api.uploads.registerUpload, { storageId });
    await t
      .withIdentity(BOB)
      .mutation(api.uploads.registerUpload, { storageId });

    const rows = await t.run(async (ctx) => ctx.db.query("uploads").collect());
    expect(rows).toHaveLength(1);
  });

  test("他世帯が登録済みのIDは横取りできない", async () => {
    const t = setup();
    await setupCouple(t);
    const storageId = await storeImage(t);
    await t
      .withIdentity(ALICE)
      .mutation(api.uploads.registerUpload, { storageId });

    // 別世帯のユーザー
    const invitation = await t
      .withIdentity(CAROL)
      .mutation(api.couples.createCouple, { displayName: "きゃろる" });
    expect(invitation.code).toBeTruthy();

    await expect(
      t.withIdentity(CAROL).mutation(api.uploads.registerUpload, { storageId }),
    ).rejects.toThrow("この画像は利用できません");
  });

  test("実体のないstorageIdは登録できない", async () => {
    const t = setup();
    await setupCouple(t);
    // 保存してすぐ消したIDは実体がない
    const storageId = await storeImage(t);
    await t.run(async (ctx) => ctx.storage.delete(storageId));

    await expect(
      t.withIdentity(ALICE).mutation(api.uploads.registerUpload, { storageId }),
    ).rejects.toThrow("この画像は利用できません");
  });
});

describe("uploads.authorizeUpload", () => {
  test("自世帯のstorageIdならcoupleIdを返す", async () => {
    const t = setup();
    await setupCouple(t);
    const storageId = await storeImage(t);
    await t
      .withIdentity(ALICE)
      .mutation(api.uploads.registerUpload, { storageId });

    const result = await t
      .withIdentity(BOB)
      .query(internal.uploads.authorizeUpload, { storageId });
    expect(result.coupleId).toBeTruthy();
  });

  test("台帳にないstorageIdは拒否する", async () => {
    const t = setup();
    await setupCouple(t);
    const storageId = await storeImage(t);

    await expect(
      t.withIdentity(ALICE).query(internal.uploads.authorizeUpload, {
        storageId,
      }),
    ).rejects.toThrow("この画像は利用できません");
  });

  test("他世帯のstorageIdは拒否する", async () => {
    const t = setup();
    await setupCouple(t);
    const storageId = await storeImage(t);
    await t
      .withIdentity(ALICE)
      .mutation(api.uploads.registerUpload, { storageId });

    await t
      .withIdentity(CAROL)
      .mutation(api.couples.createCouple, { displayName: "きゃろる" });

    await expect(
      t.withIdentity(CAROL).query(internal.uploads.authorizeUpload, {
        storageId,
      }),
    ).rejects.toThrow("この画像は利用できません");
  });

  test("未ログインでは拒否する", async () => {
    const t = setup();
    await setupCouple(t);
    const storageId: Id<"_storage"> = await storeImage(t);

    await expect(
      t.query(internal.uploads.authorizeUpload, { storageId }),
    ).rejects.toThrow("ログインしてください");
  });
});
