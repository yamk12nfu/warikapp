import { describe, expect, test } from "vitest";
import {
  buildSettlementRequestPayload,
  shouldDropSubscription,
  urlBase64ToUint8Array,
} from "./push";

describe("buildSettlementRequestPayload", () => {
  test("精算確認依頼の通知内容を固定する", () => {
    expect(
      buildSettlementRequestPayload({
        actorName: "あきこ",
        amount: 12345,
        expenseCount: 3,
      }),
    ).toEqual({
      title: "精算の確認依頼",
      body: "あきこさんが ¥12,345(3件)の精算を開始しました。内容を確認してください",
      url: "/settlement",
      tag: "settlement-request",
    });
  });
});

describe("urlBase64ToUint8Array", () => {
  test("base64url をパディングなしでもバイト列に変換する", () => {
    expect([...urlBase64ToUint8Array("AQAB")]).toEqual([1, 0, 1]);
    expect([...urlBase64ToUint8Array("_w")]).toEqual([255]);
  });
});

describe("shouldDropSubscription", () => {
  test("404 と410は購読を削除する", () => {
    expect(shouldDropSubscription(404)).toBe(true);
    expect(shouldDropSubscription(410)).toBe(true);
    expect(shouldDropSubscription(500)).toBe(false);
    expect(shouldDropSubscription(undefined)).toBe(false);
  });
});
