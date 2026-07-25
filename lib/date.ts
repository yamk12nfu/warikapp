// 日付入力(<input type="date">)用のユーティリティ。
// フォームの初期値はユーザーのローカル日付を使う(サーバー側の未来日判定は
// convex/expenses.ts の JST 基準)。

export function todayLocalDate(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
