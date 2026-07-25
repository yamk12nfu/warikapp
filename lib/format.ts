// 画面表示用の書式ユーティリティ。金額・日付の見た目を1箇所に揃える。

export function formatYen(amount: number): string {
  return `¥${amount.toLocaleString("ja-JP")}`;
}

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

// "2026-07-26" → "2026/7/26(日)"。
// 年を省略すると去年の支出と区別できないため常に付ける。曜日は日付の要素から
// 求めるので、SSRとクライアントでタイムゾーンがずれてもぶれない。
export function formatDateLabel(purchasedAt: string): string {
  const [year, month, day] = purchasedAt.split("-").map(Number);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return purchasedAt;
  }
  const weekday = WEEKDAYS[new Date(year, month - 1, day).getDay()];
  return `${year}/${month}/${day}(${weekday})`;
}
