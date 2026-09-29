import type { Doc } from "../convex/_generated/dataModel";
import {
  categoryLabel,
  effectiveItemCategory,
  normalizeCategory,
} from "./category";

type ExpenseExportFields = Pick<
  Doc<"expenses">,
  | "_id"
  | "paidBy"
  | "storeName"
  | "purchasedAt"
  | "totalAmount"
  | "items"
  | "source"
  | "status"
  | "category"
  | "settlementId"
>;

type SettlementExportFields = Pick<
  Doc<"settlements">,
  | "_id"
  | "_creationTime"
  | "fromMemberId"
  | "toMemberId"
  | "amount"
  | "memo"
  | "settledBy"
  | "expenseCount"
  | "status"
  | "confirmedBy"
  | "confirmedAt"
>;

type MemberNames = ReadonlyMap<string, string>;

const EXPENSE_HEADER = [
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
];

const SETTLEMENT_HEADER = [
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
];

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

function memberName(memberNames: MemberNames, memberId: string): string {
  return memberNames.get(memberId) ?? "メンバー";
}

function dateTimeInJst(timestamp: number): string {
  return new Date(timestamp + JST_OFFSET_MS)
    .toISOString()
    .slice(0, 16)
    .replace("T", " ");
}

export function toCsv(rows: string[][]): string {
  const lines = rows.map((row) =>
    row
      .map((cell) =>
        /[",\r\n]/.test(cell) ? `"${cell.replaceAll('"', '""')}"` : cell,
      )
      .join(","),
  );
  return `\uFEFF${lines.map((line) => `${line}\r\n`).join("")}`;
}

export function expenseRows(
  expenses: readonly ExpenseExportFields[],
  memberNames: MemberNames,
): string[][] {
  return [
    EXPENSE_HEADER,
    ...expenses.flatMap((expense) => {
      const expenseCategory = normalizeCategory(expense.category);
      return expense.items.map((item) => [
        expense._id,
        expense.purchasedAt,
        expense.storeName ?? "",
        memberName(memberNames, expense.paidBy),
        categoryLabel(expenseCategory),
        String(expense.totalAmount),
        expense.status === "draft" ? "下書き" : "確定",
        expense.settlementId ?? "",
        expense.source === "receipt" ? "レシート" : "手入力",
        item.name,
        String(item.price * item.quantity),
        String(item.quantity),
        categoryLabel(effectiveItemCategory(item.category, expenseCategory)),
        item.shares
          .map(
            (share) =>
              `${memberName(memberNames, share.memberId)} ${share.ratioPercent}%`,
          )
          .join(" / "),
      ]);
    }),
  ];
}

export function settlementRows(
  settlements: readonly SettlementExportFields[],
  memberNames: MemberNames,
): string[][] {
  return [
    SETTLEMENT_HEADER,
    ...settlements.map((settlement) => [
      settlement._id,
      dateTimeInJst(settlement._creationTime),
      settlement.status === "pending" ? "確認待ち" : "完了",
      memberName(memberNames, settlement.fromMemberId),
      memberName(memberNames, settlement.toMemberId),
      String(settlement.amount),
      String(settlement.expenseCount),
      memberName(memberNames, settlement.settledBy),
      settlement.confirmedBy === undefined
        ? ""
        : memberName(memberNames, settlement.confirmedBy),
      settlement.confirmedAt === undefined
        ? ""
        : dateTimeInJst(settlement.confirmedAt),
      settlement.memo ?? "",
    ]),
  ];
}
