// AI抽出結果を仕分けUI(ExpenseEditor)に流し込める形へ整える純粋関数。
// AI呼び出しを伴う部分(convex/ai/)と分けてあるので、ここだけはAPIキー無しで
// テストできる(lib/settlement.ts と同じ方針)。
//
// 整形の役割は3つ:
//   1. AIが返した値を expenses.save の制約(V-402 / V-403)に収まる形に均す
//   2. 数量を品目名に畳み込んで quantity を1にする(理由は normalizeItem のコメント)
//   3. 品目合計と合計金額のズレを各品目へ金額比で配分する(要件 F-003 / TBD-003)
//
// 3 は当初「差額を『調整(税・割引等)』1行にまとめる」実装だった。税別レシートを
// 実運用したところ、その行の負担区分が既定の折半になるため、片方の個人品目
// (酒・化粧品など)に掛かった消費税まで折半されてしまい、毎回手で直す必要が
// あった。しかも1行にまとまっているので「いくらを誰に寄せるのが正しいのか」を
// ユーザーが判断できない。TBD-003 の代替案どおり金額比の按分に切り替えた結果、
// 税は各品目の負担区分にそのまま従うようになり、手直しも判断も要らなくなった。

// レシートとして読めなかった(風景写真など、品目が1件も取れなかった)ときの文言。
// convex/receipts.ts が投げ、画面(S-004)は「同じ画像をもう一度AIに投げても
// 結果は変わらない」ケースの判定にも使う。両側から同じ定数を参照することで、
// 片方だけ文言を直したときに判定が静かに壊れるのを防ぐ。
export const ERR_UNREADABLE_RECEIPT =
  "レシートを読み取れませんでした。撮り直してください";

// expenses.save 側の制約に合わせる(convex/expenses.ts と同じ値)
const MAX_ITEM_NAME_LENGTH = 50;
const MAX_PRICE = 9_999_999;
const MAX_QUANTITY = 999;
// expenses.save の品目上限(V-402)。差額は既存の品目へ配分するので行は増えない
const MAX_AI_ITEMS = 100;

export type ReceiptDraftItem = {
  name: string;
  price: number; // 円・整数。「その行の合計金額」を入れる(配分後は税込)
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
  // AI由来の品目数。0なら「レシートとして読めなかった」(convex/receipts.ts が
  // この値で判定して撮り直しを促す)
  sourceItemCount: number;
  // 品目合計と合計金額の差額を各品目へ配分した場合に true。品目の金額が
  // レシートの表記(税別レシートなら税抜)と変わるので、画面はその旨を伝える
  distributed: boolean;
  // 配分した差額(円)。税別レシートなら消費税ぶんで正、総額からの値引きなら負。
  // 配分していなければ0。画面が「いくら動かしたか」を出すために使う。
  // 文言だけだとユーザーはレシートと突き合わせて確認できない
  distributedAmount: number;
  // 差額を配分できなかった場合に true。金額は「1円以上9,999,999円以下の
  // 整数」(V-403)なので、配分すると1円未満に潰れる品目が出るときは配分できない。
  // 画面はこのときだけ「金額を確認してください」と促す
  distributionSkipped: boolean;
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
// 直しようがない行は null を返して捨てる(その金額は残った品目へ配分される)。
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
// 行合計として扱う。ズレは差額の配分が吸収する)。
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

// 品目名の末尾に書かれた数量(「牛乳 x2」「牛乳 ×2」など)を外す。
// AIは数量を name に含めたり含めなかったりするので、いったん外して
// 付け直す形にする。「入っていれば足さない」だと、長い名前を50文字に
// 切り詰めるときに末尾の数量だけが落ち、数量の情報が消えてしまう
function stripQuantitySuffix(name: string, quantity: number): string {
  return name.replace(new RegExp(`\\s*[×xX*]\\s*${quantity}\\s*$`), "");
}

// 数量を品目名に畳み込んで quantity を1にする
function flattenQuantity(item: SanitizedItem): ReceiptDraftItem {
  // 数量1のときは何も足さないので、名前にも手を触れない。
  // 触ると「商品X1」のように x1 で終わる正当な品目名(型番など)を壊す
  if (item.quantity <= 1) {
    return {
      name: item.name.slice(0, MAX_ITEM_NAME_LENGTH),
      price: item.price,
      quantity: 1,
    };
  }
  // 数量2以上のときだけ、末尾の数量を外して付け直す。
  // (「商品X2」を数量2で買った場合は「商品 ×2」になるが、表示する情報は
  //  変わらないので許容する。放置すると「商品X2 ×2」になるほうが困る)
  const base = stripQuantitySuffix(item.name, item.quantity);
  const suffix = ` ×${item.quantity}`;
  // 数量は必ず残すため、切り詰めるのは品目名の側だけにする
  const name =
    base.slice(0, MAX_ITEM_NAME_LENGTH - suffix.length).trimEnd() + suffix;
  return { name, price: item.price, quantity: 1 };
}

// そのまま expenses.save に渡せる品目か(金額 V-403: 1円以上9,999,999円以下の
// 整数 / 数量: 1以上の整数)。
// 範囲だけでなく整数かどうかも見る: 比較演算は NaN に対して常に false を返すので、
// 範囲の判定だけだと NaN が「範囲内」として素通りする
function isSavableItem(item: ReceiptDraftItem): boolean {
  return (
    Number.isInteger(item.price) &&
    item.price >= 1 &&
    item.price <= MAX_PRICE &&
    Number.isInteger(item.quantity) &&
    item.quantity >= 1
  );
}

// 品目合計と合計金額の差額(税別レシートの消費税、総額からの値引きなど)を
// 各品目へ金額比で配分する(要件 F-003 / TBD-003)。配分後の品目は税込になり、
// 税は品目ごとの負担区分にそのまま従う。
//
// 端数は「累積の目標値との差」で決める。品目ごとに割合を掛けて丸めると
// 丸め誤差が積もって合計がレシート金額と1円ずれるが、累積値を丸めて前との
// 差を取る形なら、最後の品目の目標値が totalAmount そのものになるので
// 合計は必ず一致する。誤差は各品目に1円以内で散る。
export function distributeDifference(
  items: ReceiptDraftItem[],
  totalAmount: number,
): { items: ReceiptDraftItem[]; distributed: boolean; skipped: boolean } {
  const base = sumItems(items);
  // 配分できない入力は「差額0なら何もしない」より**前**に弾く。等価判定を先に
  // 見ると、1.5円 + 0.5円 = 2円 のような保存できない品目を「差額0だから正常」
  // として素通ししてしまう(合計だけ見ても各品目の妥当性は分からない)。
  //   - 品目0件: 配分先が無い
  //   - 保存できない品目がある: 配分しても保存できない(V-403 / V-404)
  //   - 品目合計が Infinity: 比率を決められない
  //   - 合計金額が整数でない: 累積の目標値を丸める前提が崩れ、
  //     配分後の合計が totalAmount と一致しなくなる
  // 呼び出し元(normalizeParsedReceipt)は sanitizeItem で均してから渡すが、
  // この関数単体の契約としてもここで保証する
  if (
    items.length === 0 ||
    !items.every(isSavableItem) ||
    !Number.isFinite(base) ||
    !Number.isInteger(totalAmount)
  ) {
    return { items, distributed: false, skipped: true };
  }
  if (base === totalAmount) {
    return { items, distributed: false, skipped: false };
  }

  let allocated = 0;
  let cumulative = 0;
  const distributed = items.map((item) => {
    cumulative += item.price * item.quantity;
    // 「先頭からこの品目までの合計は、配分後いくらであるべきか」
    const target = Math.round((totalAmount * cumulative) / base);
    const price = target - allocated;
    allocated = target;
    // price は「行の合計金額」なので quantity は1に落とす。残すと配分後の
    // 行合計に数量が二重に効く(呼び出し元は畳み込み済みだが、念のため)
    return { ...item, price, quantity: 1 };
  });

  // マイナスの差額が大きく、小さな品目が1円未満に潰れるようなときは配分を
  // 諦めて画面で直してもらう(中途半端に丸めると合計がレシート金額と合わなくなる)
  if (!distributed.every(isSavableItem)) {
    return { items, distributed: false, skipped: true };
  }
  return { items: distributed, distributed: true, skipped: false };
}

// AI抽出結果 → 画面に流し込める形。today はJST基準の当日("YYYY-MM-DD")。
export function normalizeParsedReceipt(
  parsed: RawParsedReceipt,
  today: string,
): NormalizedReceipt {
  // 上限で切るのは「保存できる品目」を数えたあと。先に切ると、前の方に
  // 捨てられる行があったぶんだけ後ろの有効な品目まで落ちてしまう
  const sanitized = parsed.items
    .map(sanitizeItem)
    .filter((item): item is SanitizedItem => item !== null)
    .slice(0, MAX_AI_ITEMS);

  const rawTotal = Math.round(parsed.total_amount);
  const hasTotal = Number.isFinite(rawTotal) && rawTotal > 0;

  // 合計が読めた場合だけ「単価/行合計」の判定に使える
  const lineTotals = hasTotal
    ? toLineTotals(sanitized, rawTotal)
    : sanitized;
  const items = lineTotals.map(flattenQuantity);

  // 合計が読めなかった場合は品目合計で代用する(差額0=配分なし)
  const totalAmount = hasTotal ? rawTotal : sumItems(items);

  const adjusted = distributeDifference(items, totalAmount);

  return {
    storeName: normalizeStoreName(parsed.store_name),
    purchasedAt: normalizePurchasedAt(parsed.purchased_at, today),
    totalAmount,
    items: adjusted.items,
    sourceItemCount: items.length,
    distributed: adjusted.distributed,
    // 配分「前」の品目合計との差。items は配分前の値なのでここで計算できる
    distributedAmount: adjusted.distributed ? totalAmount - sumItems(items) : 0,
    distributionSkipped: adjusted.skipped,
  };
}
