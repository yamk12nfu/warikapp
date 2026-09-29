/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const identity = (name: string) => ({
  issuer: "https://clerk.test",
  subject: name,
  tokenIdentifier: `https://clerk.test|${name}`,
});

const ALICE = identity("alice");
const BOB = identity("bob");
const CAROL = identity("carol");
const KEYS = { p256dh: "public-key", auth: "auth-key" };

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

test("同じ endpoint を再購読しても1行で最新の鍵に更新する", async () => {
  const t = convexTest(schema, modules);
  await setupCouple(t);
  const endpoint = "https://push.example.com/alice";

  await t.withIdentity(ALICE).mutation(api.push.subscribe, {
    endpoint,
    keys: KEYS,
  });
  await t.withIdentity(ALICE).mutation(api.push.subscribe, {
    endpoint,
    keys: { p256dh: "updated-key", auth: "updated-auth" },
  });

  const rows = await t.run(async (ctx) =>
    await ctx.db
      .query("pushSubscriptions")
      .withIndex("by_endpoint", (q) => q.eq("endpoint", endpoint))
      .collect(),
  );
  expect(rows).toHaveLength(1);
  expect(rows[0].keys).toEqual({
    p256dh: "updated-key",
    auth: "updated-auth",
  });
});

test("購読解除後は isSubscribed が false になる", async () => {
  const t = convexTest(schema, modules);
  await setupCouple(t);
  const endpoint = "https://push.example.com/alice";

  await t.withIdentity(ALICE).mutation(api.push.subscribe, {
    endpoint,
    keys: KEYS,
  });
  await t.withIdentity(ALICE).mutation(api.push.unsubscribe, { endpoint });

  await expect(
    t.withIdentity(ALICE).query(api.push.isSubscribed, { endpoint }),
  ).resolves.toBe(false);
});

test("他世帯の endpoint を解除・上書きできない", async () => {
  const t = convexTest(schema, modules);
  await setupCouple(t);
  await t.withIdentity(CAROL).mutation(api.couples.createCouple, {
    displayName: "きゃろる",
  });
  const endpoint = "https://push.example.com/alice";
  await t.withIdentity(ALICE).mutation(api.push.subscribe, {
    endpoint,
    keys: KEYS,
  });

  await t.withIdentity(CAROL).mutation(api.push.unsubscribe, { endpoint });
  await expect(
    t.withIdentity(CAROL).mutation(api.push.subscribe, {
      endpoint,
      keys: { p256dh: "hijack", auth: "hijack" },
    }),
  ).rejects.toThrow("権限がありません");

  await expect(
    t.withIdentity(ALICE).query(api.push.isSubscribed, { endpoint }),
  ).resolves.toBe(true);
});
