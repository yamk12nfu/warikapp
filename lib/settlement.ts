import type { ExpenseItemInput } from "./types";

// 支出金額と立て替え額の計算。純粋関数として置き、仕分けUIの表示・
// expenses.save の totalAmount 算出・Phase 7 の精算mutationから共用する
// (Convex関数はプロジェクト内のファイルを普通にimportできる)。

// 品目合計。支出の totalAmount はこの値を保存する
export function calcTotalAmount(items: ExpenseItemInput[]): number {
  return items.reduce((sum, item) => sum + item.price * item.quantity, 0);
}

// 品目金額 × 割合。端数は品目ごとに四捨五入する(要件 F-007)
function shareAmount(item: ExpenseItemInput, ratioPercent: number): number {
  return Math.round((item.price * item.quantity * ratioPercent) / 100);
}

// 1品目のうち指定メンバーが負担する金額。支出詳細(S-005)の内訳表示に使う
export function calcItemShareAmount(
  item: ExpenseItemInput,
  memberId: string,
): number {
  const ratio = item.shares
    .filter((s) => s.memberId === memberId)
    .reduce((r, s) => r + s.ratioPercent, 0);
  return shareAmount(item, ratio);
}

// 1つの支出について「支払者が相手の分を立て替えた金額」を返す。
// 品目単位で 品目金額 × 相手の負担割合% を計算し、品目ごとに四捨五入(要件 F-007)
export function calcAdvanceAmount(
  paidBy: string,
  items: ExpenseItemInput[],
): number {
  return items.reduce((sum, item) => {
    const otherRatio = item.shares
      .filter((s) => s.memberId !== paidBy)
      .reduce((r, s) => r + s.ratioPercent, 0);
    return sum + shareAmount(item, otherRatio);
  }, 0);
}
