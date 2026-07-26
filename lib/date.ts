// 日付のユーティリティ。フォームの初期値はユーザーのローカル日付を使い、
// サーバー側の未来日判定は JST 基準で行う。

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

// JST(UTC+9)基準の今日。Convexの実行環境はUTCのため加算して求める。
// mutation / action での Date.now() は許容される
// (queryでは時間経過で再実行されず結果が陳腐化するため禁止)。
export function todayInJst(): string {
  return new Date(Date.now() + JST_OFFSET_MS).toISOString().slice(0, 10);
}

export function todayLocalDate(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
