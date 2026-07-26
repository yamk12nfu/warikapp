// AI抽出結果を仕分けUI(ExpenseEditor)に流し込める形へ整える純粋関数。
// AI呼び出しを伴う部分(convex/ai/)と分けてあるので、ここだけはAPIキー無しで
// テストできる(lib/settlement.ts と同じ方針)。
//
// 整形の役割は2つ:
//   1. AIが返した値を expenses.save の制約(V-402 / V-403)に収まる形に均す
//   2. 品目合計と合計金額のズレを「調整(税・割引等)」品目として吸収する(要件 F-003)

export const ADJUSTMENT_ITEM_NAME = "調整(税・割引等)";

// expenses.save 側の制約に合わせる(convex/expenses.ts と同じ値)
const MAX_ITEM_NAME_LENGTH = 50;
const MAX_PRICE = 9_999_999;
const MAX_QUANTITY = 999;
// 調整行を足しても上限(100件)を超えないようにAI由来の品目は99件までにする
const MAX_AI_ITEMS = 99;

export type ReceiptDraftItem = {
  name: string;
  price: number; // 税込・円・整数
  quantity: number;
};

// AIからの生の抽出結果(convex/ai/types.ts の ParsedReceipt と同じ形)。
// lib/ は Convex に依存させたくないのでここで構造だけ受ける。
export type RawParsedReceipt = {
  store_name: string | null;
  purchased_at: string | null;
  total_amount: number;
  items: { name: string; price: number; quantity: number }[];
};

export type NormalizedReceipt = {
  storeName: string | null;
  purchasedAt: string | null; // 妥当でなければ null(画面側で当日を既定にする)
  totalAmount: number;
  items: ReceiptDraftItem[];
  // 品目合計が合計金額を上回っていて調整行にできなかった場合に true。
  // 金額は「1円以上の整数」(V-403)なのでマイナスの調整行が作れず、
  // 差額を吸収できない。画面はこのときだけ「金額を確認してください」と促す
  droppedNegativeAdjustment: boolean;
};

export function sumItems(items: ReceiptDraftItem[]): number {
  return items.reduce((sum, item) => sum + item.price * item.quantity, 0);
}

// "YYYY-MM-DD" として妥当で、かつ未来日でなければそのまま返す。
// today は JST基準の当日("YYYY-MM-DD")を呼び出し側から渡す
// (この関数自体は時刻を読まないのでテストが安定する)。
export function normalizePurchasedAt(
  purchasedAt: string | null,
  today: string,
): string | null {
  if (purchasedAt === null || !/^\d{4}-\d{2}-\d{2}$/.test(purchasedAt)) {
    return null;
  }
  // 2026-02-31 のような実在しない日付を弾く(Dateは繰り上げるため往復で確認)
  const parsed = new Date(`${purchasedAt}T00:00:00.000Z`);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== purchasedAt
  ) {
    return null;
  }
  // "YYYY-MM-DD" は辞書順=日付順
  return purchasedAt > today ? null : purchasedAt;
}

function normalizeStoreName(storeName: string | null): string | null {
  if (storeName === null) {
    return null;
  }
  const trimmed = storeName.trim();
  if (trimmed.length === 0) {
    return null;
  }
  return trimmed.slice(0, MAX_ITEM_NAME_LENGTH);
}

// AI由来の1品目を保存可能な形に均す。名前が空・金額が1円未満など
// 直しようがない行は null を返して捨てる(差額は調整行が吸収する)。
function normalizeItem(item: {
  name: string;
  price: number;
  quantity: number;
}): ReceiptDraftItem | null {
  const name = item.name.trim().slice(0, MAX_ITEM_NAME_LENGTH);
  if (name.length === 0) {
    return null;
  }
  const price = Math.round(item.price);
  if (!Number.isFinite(price) || price < 1 || price > MAX_PRICE) {
    return null;
  }
  const rounded = Math.round(item.quantity);
  const quantity =
    Number.isFinite(rounded) && rounded >= 1
      ? Math.min(rounded, MAX_QUANTITY)
      : 1;
  return { name, price, quantity };
}

// 品目合計と合計金額の差額を「調整(税・割引等)」として品目に足す(要件 F-003)。
// 負担区分の初期値(折半)は画面側の既定値がそのまま適用される。
export function withAdjustmentItem(
  items: ReceiptDraftItem[],
  totalAmount: number,
): { items: ReceiptDraftItem[]; droppedNegativeAdjustment: boolean } {
  const difference = totalAmount - sumItems(items);
  if (difference === 0) {
    return { items, droppedNegativeAdjustment: false };
  }
  if (difference < 0) {
    // マイナスの品目は作れない(V-403)。画面で金額を直してもらう
    return { items, droppedNegativeAdjustment: true };
  }
  return {
    items: [
      ...items,
      { name: ADJUSTMENT_ITEM_NAME, price: difference, quantity: 1 },
    ],
    droppedNegativeAdjustment: false,
  };
}

// AI抽出結果 → 画面に流し込める形。today はJST基準の当日("YYYY-MM-DD")。
export function normalizeParsedReceipt(
  parsed: RawParsedReceipt,
  today: string,
): NormalizedReceipt {
  const items = parsed.items
    .slice(0, MAX_AI_ITEMS)
    .map(normalizeItem)
    .filter((item): item is ReceiptDraftItem => item !== null);

  const rawTotal = Math.round(parsed.total_amount);
  // 合計が読めなかった場合は品目合計で代用する(差額0=調整行なし)
  const totalAmount =
    Number.isFinite(rawTotal) && rawTotal > 0 ? rawTotal : sumItems(items);

  const adjusted = withAdjustmentItem(items, totalAmount);

  return {
    storeName: normalizeStoreName(parsed.store_name),
    purchasedAt: normalizePurchasedAt(parsed.purchased_at, today),
    totalAmount,
    items: adjusted.items,
    droppedNegativeAdjustment: adjusted.droppedNegativeAdjustment,
  };
}
