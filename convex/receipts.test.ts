/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
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

// AI読み取り(receipts.parse)のうち、AI呼び出しの手前で決まる部分を検証する。
// 実際のAI応答の整形は lib/receipt.test.ts で純粋関数として検証している。
//
// プロバイダには実在しない名前を入れる。claude / gemini のままだと、開発機に
// APIキーがあるときに本物のAPIを叩いてしまう(課金・ネットワーク依存・
// タイムアウト)。未対応プロバイダはその場で ConvexError になるので、
// 「AI呼び出しに入った=認可とレート制限を通過した」ことだけを確かめられる。
const ERR_PROVIDER = "未対応のAIプロバイダが設定されています";

beforeEach(() => {
  vi.stubEnv("RECEIPT_AI_PROVIDER", "test-no-provider");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function setup() {
  const t = convexTest(schema, modules);
  // レート制限はコンポーネント(別テーブル)なのでテストにも登録が要る
  rateLimiterTest.register(t);
  return t;
}

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

async function storeAndRegister(
  t: ReturnType<typeof convexTest>,
  who = ALICE,
) {
  const storageId = await t.run(async (ctx) =>
    ctx.storage.store(
      new Blob([new Uint8Array([1, 2, 3])], { type: "image/jpeg" }),
    ),
  );
  await t.withIdentity(who).mutation(api.uploads.registerUpload, { storageId });
  return storageId;
}

describe("receipts.parse の認可", () => {
  test("未ログインでは呼べない", async () => {
    const t = setup();
    await setupCouple(t);
    const storageId = await storeAndRegister(t);

    await expect(t.action(api.receipts.parse, { storageId })).rejects.toThrow(
      "ログインしてください",
    );
  });

  test("台帳にないstorageIdは読み取れない", async () => {
    const t = setup();
    await setupCouple(t);
    const storageId = await t.run(async (ctx) =>
      ctx.storage.store(new Blob([new Uint8Array([1])], { type: "image/jpeg" })),
    );

    await expect(
      t.withIdentity(ALICE).action(api.receipts.parse, { storageId }),
    ).rejects.toThrow("この画像は利用できません");
  });

  test("他世帯がアップロードした画像は読み取れない", async () => {
    const t = setup();
    await setupCouple(t);
    const storageId = await storeAndRegister(t);

    await t
      .withIdentity(CAROL)
      .mutation(api.couples.createCouple, { displayName: "きゃろる" });

    await expect(
      t.withIdentity(CAROL).action(api.receipts.parse, { storageId }),
    ).rejects.toThrow("この画像は利用できません");
  });
});

describe("receipts.parse のレート制限", () => {
  test("世帯あたり30回/時を超えると断られる", async () => {
    const t = setup();
    await setupCouple(t);
    const storageId = await storeAndRegister(t);

    // 30回ぶんの枠を使い切る(プロバイダが未実装なので読み取り自体は失敗するが、
    // 失敗した呼び出しも枠を消費する = 連打で暴走させない、が意図)
    for (let count = 0; count < 30; count += 1) {
      await expect(
        t.withIdentity(ALICE).action(api.receipts.parse, { storageId }),
      ).rejects.toThrow(ERR_PROVIDER);
    }

    // 31回目は同じ世帯の別メンバーから呼んでも断られる(世帯単位の制限)
    await expect(
      t.withIdentity(BOB).action(api.receipts.parse, { storageId }),
    ).rejects.toThrow("読み取りの回数制限に達しました");
  });
});
