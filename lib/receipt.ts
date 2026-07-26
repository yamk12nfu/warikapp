// AI抽出結果を仕分けUI(ExpenseEditor)に流し込める形へ整える純粋関数。
// AI呼び出しを伴う部分(convex/ai/)と分けてあるので、ここだけはAPIキー無しで
// テストできる(lib/settlement.ts と同じ方針)。
//
// 整形の役割は3つ:
//   1. AIが返した値を expenses.save の制約(V-402 / V-403)に収まる形に均す
//   2. 数量を品目名に畳み込んで quantity を1にする(理由は normalizeItem のコメント)
//   3. 品目合計と合計金額のズレを「調整(税・割引等)」品目として吸収する(要件 F-003)

export const ADJUSTMENT_ITEM_NAME = "調整(税・割引等)";

// expenses.save 側の制約に合わせる(convex/expenses.ts と同じ値)
const MAX_ITEM_NAME_LENGTH = 50;
const MAX_PRICE = 9_999_999;
const MAX_QUANTITY = 999;
// 調整行を足しても上限(100件)を超えないようにAI由来の品目は99件までにする
const MAX_AI_ITEMS = 99;

export type ReceiptDraftItem = {
  name: string;
  price: number; // 税込・円・整数。「その行の合計金額」を入れる
  // AI由来の品目は常に1。数量は品目名に「×3」として残す(下の normalizeItem 参照)
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
  // 調整行を足す前の、AI由来の品目数。0なら「レシートとして読めなかった」。
  // items の件数で判定すると、品目0件でも合計金額だけ返ってきたときに
  // 調整行だけの支出ができてしまう
  sourceItemCount: number;
  // 差額を調整行にできなかった場合に true。金額は「1円以上9,999,999円以下の
  // 整数」(V-403)なので、差額がマイナスのときと上限を超えるときは行を作れない。
  // 画面はこのときだけ「金額を確認してください」と促す
  adjustmentSkipped: boolean;
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
//
// **数量は品目名に畳み込み、quantity は常に1にする**。理由:
//   - AIには「price = その行の合計金額」を返させている。そのまま quantity を
//     残すと、金額の計算(price × quantity)が数量ぶん二重に効いてしまう
//   - 仕分けUI(ExpenseEditor)は数量の入力欄を持たない(Phase 5の設計)。
//     quantity を残すと、画面に出ない値が合計に効く=ユーザーが読み取り誤りを
//     確認も修正もできない状態になる
// 数量の情報は「牛乳 ×3」のように品目名へ残すので、画面で確認・修正できる。
type SanitizedItem = { name: string; price: number; quantity: number };

// 値の範囲だけを均す(数量はまだ残す)。直しようがない行は null で捨てる
function sanitizeItem(item: {
  name: string;
  price: number;
  quantity: number;
}): SanitizedItem | null {
  const name = item.name.trim();
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

// price を「行の合計金額」に揃える。
// プロンプトでは行の合計を返すよう指示しているが、AIが単価を返すこともある。
// レシートの合計金額と突き合わせて「単価として掛けたときだけ一致する」場合は
// 単価だったとみなして行合計に直す(どちらとも判定できないときは指示どおり
// 行合計として扱う。ズレは調整行が吸収する)。
function toLineTotals(
  items: SanitizedItem[],
  totalAmount: number,
): SanitizedItem[] {
  const asLineTotals = items.reduce((sum, item) => sum + item.price, 0);
  const asUnitPrices = items.reduce(
    (sum, item) => sum + item.price * item.quantity,
    0,
  );
  if (asLineTotals === totalAmount || asUnitPrices !== totalAmount) {
    return items;
  }
  const multiplied = items.map((item) => ({
    ...item,
    price: item.price * item.quantity,
  }));
  // 掛けた結果が金額の上限を超えるなら判定を採用しない
  return multiplied.some((item) => item.price > MAX_PRICE) ? items : multiplied;
}

// 数量を品目名に畳み込んで quantity を1にする
function flattenQuantity(item: SanitizedItem): ReceiptDraftItem {
  // 数量を名前の末尾に付ける。付けたうえで50文字に収める
  const suffix = item.quantity > 1 ? ` ×${item.quantity}` : "";
  const name =
    item.name.slice(0, MAX_ITEM_NAME_LENGTH - suffix.length) + suffix;
  return { name, price: item.price, quantity: 1 };
}

// 品目合計と合計金額の差額を「調整(税・割引等)」として品目に足す(要件 F-003)。
// 負担区分の初期値(折半)は画面側の既定値がそのまま適用される。
export function withAdjustmentItem(
  items: ReceiptDraftItem[],
  totalAmount: number,
): { items: ReceiptDraftItem[]; adjustmentSkipped: boolean } {
  const difference = totalAmount - sumItems(items);
  if (difference === 0) {
    return { items, adjustmentSkipped: false };
  }
  // 金額は1円以上9,999,999円以下の整数(V-403)。マイナスの差額も、
  // 上限を超える差額も品目にできないので、画面で直してもらう
  if (difference < 0 || difference > MAX_PRICE) {
    return { items, adjustmentSkipped: true };
  }
  return {
    items: [
      ...items,
      { name: ADJUSTMENT_ITEM_NAME, price: difference, quantity: 1 },
    ],
    adjustmentSkipped: false,
  };
}

// AI抽出結果 → 画面に流し込める形。today はJST基準の当日("YYYY-MM-DD")。
export function normalizeParsedReceipt(
  parsed: RawParsedReceipt,
  today: string,
): NormalizedReceipt {
  const sanitized = parsed.items
    .slice(0, MAX_AI_ITEMS)
    .map(sanitizeItem)
    .filter((item): item is SanitizedItem => item !== null);

  const rawTotal = Math.round(parsed.total_amount);
  const hasTotal = Number.isFinite(rawTotal) && rawTotal > 0;

  // 合計が読めた場合だけ「単価/行合計」の判定に使える
  const lineTotals = hasTotal
    ? toLineTotals(sanitized, rawTotal)
    : sanitized;
  const items = lineTotals.map(flattenQuantity);

  // 合計が読めなかった場合は品目合計で代用する(差額0=調整行なし)
  const totalAmount = hasTotal ? rawTotal : sumItems(items);

  const adjusted = withAdjustmentItem(items, totalAmount);

  return {
    storeName: normalizeStoreName(parsed.store_name),
    purchasedAt: normalizePurchasedAt(parsed.purchased_at, today),
    totalAmount,
    items: adjusted.items,
    sourceItemCount: items.length,
    adjustmentSkipped: adjusted.adjustmentSkipped,
  };
}
