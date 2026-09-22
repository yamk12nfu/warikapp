import { describe, expect, test } from "vitest";
import {
  suggestReceiptItemSharesFromHistory,
  type ShareMemoryHousehold,
} from "./share-memory";
import type { ShareRatio } from "./types";

const SELF = "member-self";
const PARTNER = "member-partner";

const household = { selfId: SELF, partnerId: PARTNER };
const solo = { selfId: SELF, partnerId: null };

const split: ShareRatio[] = [
  { memberId: SELF, ratioPercent: 50 },
  { memberId: PARTNER, ratioPercent: 50 },
];
const partnerOnly: ShareRatio[] = [
  { memberId: PARTNER, ratioPercent: 100 },
];
const selfOnly: ShareRatio[] = [
  { memberId: SELF, ratioPercent: 100 },
];

function suggest(
  itemNames: string[],
  history: Parameters<typeof suggestReceiptItemSharesFromHistory>[0]["history"],
  members: ShareMemoryHousehold = household,
) {
  return suggestReceiptItemSharesFromHistory({
    itemNames,
    history,
    household: members,
  });
}

describe("suggestReceiptItemSharesFromHistory", () => {
  test("数量サフィックスを外した品目名で一致する", () => {
    const result = suggest(["牛乳 ×3"], [
      { status: "confirmed", items: [{ name: "牛乳", shares: partnerOnly }] },
    ]);
    expect(result.sharesByItem).toEqual([
      [
        { memberId: SELF, ratioPercent: 0 },
        { memberId: PARTNER, ratioPercent: 100 },
      ],
    ]);
  });

  test("新しい確定支出が勝つ", () => {
    const result = suggest(["牛乳"], [
      { status: "confirmed", items: [{ name: "牛乳", shares: partnerOnly }] },
      { status: "confirmed", items: [{ name: "牛乳", shares: selfOnly }] },
    ]);
    expect(result.sharesByItem).toEqual([
      [
        { memberId: SELF, ratioPercent: 0 },
        { memberId: PARTNER, ratioPercent: 100 },
      ],
    ]);
  });

  test("同じ支出では後ろの行が勝つ", () => {
    const result = suggest(["牛乳"], [
      {
        status: "confirmed",
        items: [
          { name: "牛乳", shares: split },
          { name: "牛乳", shares: partnerOnly },
        ],
      },
    ]);
    expect(result.sharesByItem).toEqual([
      [
        { memberId: SELF, ratioPercent: 0 },
        { memberId: PARTNER, ratioPercent: 100 },
      ],
    ]);
  });

  test("ドラフトは使わず、より古い確定を採用する", () => {
    const result = suggest(["牛乳"], [
      { status: "draft", items: [{ name: "牛乳", shares: partnerOnly }] },
      { status: "confirmed", items: [{ name: "牛乳", shares: split }] },
    ]);
    expect(result.sharesByItem).toEqual([split]);
  });

  test("不正な割合はキーを埋めず、より古い正しい割合を使う", () => {
    const result = suggest(["牛乳"], [
      {
        status: "confirmed",
        items: [{ name: "牛乳", shares: [{ memberId: SELF, ratioPercent: 40 }] }],
      },
      { status: "confirmed", items: [{ name: "牛乳", shares: partnerOnly }] },
    ]);
    expect(result.sharesByItem).toEqual([
      [
        { memberId: SELF, ratioPercent: 0 },
        { memberId: PARTNER, ratioPercent: 100 },
      ],
    ]);
  });

  test("パートナー未参加なら履歴があっても自分100%に載せ替える", () => {
    const result = suggest(
      ["牛乳"],
      [{ status: "confirmed", items: [{ name: "牛乳", shares: split }] }],
      solo,
    );
    expect(result.sharesByItem).toEqual([
      [{ memberId: SELF, ratioPercent: 100 }],
    ]);
  });

  test("現世帯に無い memberId はキーを埋めず、より古い正しい割合を使う", () => {
    const result = suggest(["牛乳"], [
      {
        status: "confirmed",
        items: [
          { name: "牛乳", shares: [{ memberId: "ghost", ratioPercent: 100 }] },
        ],
      },
      { status: "confirmed", items: [{ name: "牛乳", shares: partnerOnly }] },
    ]);
    expect(result.sharesByItem).toEqual([
      [
        { memberId: SELF, ratioPercent: 0 },
        { memberId: PARTNER, ratioPercent: 100 },
      ],
    ]);
  });

  test("履歴が無ければ折半になる", () => {
    const result = suggest(["パン"], []);
    expect(result.sharesByItem).toEqual([split]);
  });

  test("同じ品目名は同じ負担区分になる", () => {
    const result = suggest(["牛乳", "牛乳"], [
      { status: "confirmed", items: [{ name: "牛乳", shares: partnerOnly }] },
    ]);
    expect(result.sharesByItem).toEqual([
      [
        { memberId: SELF, ratioPercent: 0 },
        { memberId: PARTNER, ratioPercent: 100 },
      ],
      [
        { memberId: SELF, ratioPercent: 0 },
        { memberId: PARTNER, ratioPercent: 100 },
      ],
    ]);
  });

  test("精算済みでも status が confirmed なら採用する", () => {
    const result = suggest(["牛乳"], [
      { status: "confirmed", items: [{ name: "牛乳", shares: selfOnly }] },
    ]);
    expect(result.sharesByItem).toEqual([
      [
        { memberId: SELF, ratioPercent: 100 },
        { memberId: PARTNER, ratioPercent: 0 },
      ],
    ]);
  });

  test("入力と同じ長さの配列を必ず返す", () => {
    const result = suggest(["牛乳", "パン", "卵"], [
      { status: "confirmed", items: [{ name: "牛乳", shares: partnerOnly }] },
    ]);
    expect(result.sharesByItem).toHaveLength(3);
    expect(result.sharesByItem[1]).toEqual(split);
    expect(result.sharesByItem[2]).toEqual(split);
  });
});
