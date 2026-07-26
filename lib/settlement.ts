import type { ExpenseItemInput } from "./types";

// 支出金額と立て替え額の計算。純粋関数として置き、仕分けUIの表示・
// expenses.save の totalAmount 算出・精算(settlements)の各関数から共用する
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

// 差額計算(F-007)の入力。Convexの支出ドキュメントをそのまま渡せる形にしてある。
// メンバーIDを型変数にしてあるのは、Convex側から Id<"members"> を渡したときに
// 戻り値の from/to も Id<"members"> のままにするため(画面側は string で使える)
export type SettlementExpenseInput<TMemberId extends string = string> = {
  paidBy: TMemberId;
  items: ExpenseItemInput[];
};

// 世帯全体の未精算差額。amount は常に0以上で、0のときは方向を持たない
export type SettlementBalance<TMemberId extends string = string> = {
  fromMemberId: TMemberId | null; // 支払う側
  toMemberId: TMemberId | null; // 受け取る側
  amount: number;
};

// 世帯全体の未精算差額(要件 F-007 の式そのまま):
//   netA = Σ(Aが支払った支出のAの立て替え額) − Σ(Bが支払った支出のBの立て替え額)
//   netA > 0 →「BがAにnetA円支払う」/ netA < 0 → 逆 / 0 → 精算不要
// 支出ごとの丸め(品目単位の四捨五入)を先に済ませてから合算するため、
// 合計金額から割合を掛け直した値とは1円単位でずれうる。丸めの基準は
// calcAdvanceAmount(=支出詳細の表示)と揃えてあるので、画面の表示とは一致する。
export function calcNetBalance<TMemberId extends string>(
  memberA: TMemberId,
  memberB: TMemberId,
  expenses: SettlementExpenseInput<TMemberId>[],
): SettlementBalance<TMemberId> {
  const netA = expenses.reduce((sum, expense) => {
    if (expense.paidBy === memberA) {
      return sum + calcAdvanceAmount(memberA, expense.items);
    }
    if (expense.paidBy === memberB) {
      return sum - calcAdvanceAmount(memberB, expense.items);
    }
    // どちらでもない支払者(想定外のデータ)は差額に含めない
    return sum;
  }, 0);

  if (netA === 0) {
    return { fromMemberId: null, toMemberId: null, amount: 0 };
  }
  return netA > 0
    ? { fromMemberId: memberB, toMemberId: memberA, amount: netA }
    : { fromMemberId: memberA, toMemberId: memberB, amount: -netA };
}
