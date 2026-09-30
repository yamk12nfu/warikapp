import { describe, expect, test } from "vitest";
import { expenseRows, settlementRows, toCsv } from "./csv";
import type { Doc, Id } from "../convex/_generated/dataModel";

const memberNames = new Map<string, string>([
  ["members:akiko", "あきこ"],
  ["members:bob", "ぼぶ"],
]);

const expense: Doc<"expenses"> = {
  _id: "expenses:one" as Id<"expenses">,
  _creationTime: Date.parse("2026-02-03T10:00:00.000Z"),
  coupleId: "couples:one" as Id<"couples">,
  paidBy: "members:akiko" as Id<"members">,
  storeName: "八百屋",
  purchasedAt: "2026-02-03",
  totalAmount: 2500,
  items: [
    {
      name: "りんご",
      price: 500,
      quantity: 2,
      category: undefined,
      shares: [
        { memberId: "members:akiko" as Id<"members">, ratioPercent: 50 },
        { memberId: "members:bob" as Id<"members">, ratioPercent: 50 },
      ],
    },
    {
      name: "パン",
      price: 1500,
      quantity: 1,
      category: "daily",
      shares: [{ memberId: "members:akiko" as Id<"members">, ratioPercent: 100 }],
    },
  ],
  source: "receipt",
  status: "confirmed",
  category: "food",
  settlementId: "settlements:one" as Id<"settlements">,
};

describe("toCsv", () => {
  test("BOM付きUTF-8のCSVをRFC 4180形式で引用し、CRLFで終端する", () => {
    expect(
      toCsv([
        ["単純", "カンマ,あり", '引用"あり', "改行\nあり"],
        ["2行目", "", "", ""],
      ]),
    ).toBe(
      '\uFEFF単純,"カンマ,あり","引用""あり","改行\nあり"\r\n2行目,,,\r\n',
    );
  });
});

describe("expenseRows", () => {
  test("ヘッダーと支出情報を各品目行に繰り返し、品目分類と負担割合を出力する", () => {
    expect(expenseRows([expense], memberNames)).toEqual([
      [
        "支出ID",
        "購入日",
        "店名",
        "支払者",
        "分類",
        "支出合計",
        "状態",
        "精算ID",
        "入力元",
        "品目名",
        "品目金額",
        "数量",
        "品目分類",
        "負担割合",
      ],
      [
        "expenses:one",
        "2026-02-03",
        "八百屋",
        "あきこ",
        "食費",
        "2500",
        "確定",
        "settlements:one",
        "レシート",
        "りんご",
        "1000",
        "2",
        "食費",
        "あきこ 50% / ぼぶ 50%",
      ],
      [
        "expenses:one",
        "2026-02-03",
        "八百屋",
        "あきこ",
        "食費",
        "2500",
        "確定",
        "settlements:one",
        "レシート",
        "パン",
        "1500",
        "1",
        "日用品",
        "あきこ 100%",
      ],
    ]);
  });
});

describe("settlementRows", () => {
  test("ヘッダー、JST日時、状態、参加者名と確認者を出力する", () => {
    const settlement: Doc<"settlements"> = {
      _id: "settlements:one" as Id<"settlements">,
      _creationTime: Date.parse("2026-02-03T18:30:00.000Z"),
      coupleId: "couples:one" as Id<"couples">,
      fromMemberId: "members:bob" as Id<"members">,
      toMemberId: "members:akiko" as Id<"members">,
      amount: 4500,
      memo: "2月分",
      settledBy: "members:bob" as Id<"members">,
      expenseCount: 3,
      status: "completed",
      confirmedBy: "members:akiko" as Id<"members">,
      confirmedAt: Date.parse("2026-02-04T02:05:00.000Z"),
    };

    expect(settlementRows([settlement], memberNames)).toEqual([
      [
        "精算ID",
        "開始日時",
        "状態",
        "支払う側",
        "受け取る側",
        "金額",
        "対象件数",
        "開始した人",
        "確認した人",
        "確認日時",
        "メモ",
      ],
      [
        "settlements:one",
        "2026-02-04 03:30",
        "完了",
        "ぼぶ",
        "あきこ",
        "4500",
        "3",
        "ぼぶ",
        "あきこ",
        "2026-02-04 11:05",
        "2月分",
      ],
    ]);
  });

  test("status が未設定の過去精算は完了として出力する", () => {
    const legacySettlement: Doc<"settlements"> = {
      _id: "settlements:legacy" as Id<"settlements">,
      _creationTime: Date.parse("2026-02-03T18:30:00.000Z"),
      coupleId: "couples:one" as Id<"couples">,
      fromMemberId: "members:bob" as Id<"members">,
      toMemberId: "members:akiko" as Id<"members">,
      amount: 4500,
      settledBy: "members:bob" as Id<"members">,
      expenseCount: 3,
    };

    expect(settlementRows([legacySettlement], memberNames)).toEqual([
      [
        "精算ID",
        "開始日時",
        "状態",
        "支払う側",
        "受け取る側",
        "金額",
        "対象件数",
        "開始した人",
        "確認した人",
        "確認日時",
        "メモ",
      ],
      [
        "settlements:legacy",
        "2026-02-04 03:30",
        "完了",
        "ぼぶ",
        "あきこ",
        "4500",
        "3",
        "ぼぶ",
        "",
        "",
        "",
      ],
    ]);
  });
});
