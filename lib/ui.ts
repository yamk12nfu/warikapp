// 共通の見た目クラス(案「ふたり」)。色や角丸の値は globals.css のトークンが
// 正で、ここは「部品ごとの組み合わせ」だけを持つ。画面側はここから import し、
// 画面固有の余白・配置だけを各ファイルに書く。

// カード: 白地+角丸+柔らかい影。枠線で区切っていた旧デザインの置き換え
export const cardClass = "rounded-2xl bg-surface p-4 shadow-card";

// 一覧の行(タップできるカード)
export const rowCardClass = "rounded-2xl bg-surface p-3 shadow-card";

// 主要アクション(1画面に1つ)
export const primaryButtonClass =
  "rounded-full bg-me px-4 py-3 text-center text-sm font-bold text-white disabled:opacity-50";

// 準主要アクション(主要の隣に置く同格の選択肢)
export const secondaryButtonClass =
  "rounded-full bg-me-soft px-4 py-3 text-center text-sm font-bold text-me-strong disabled:opacity-50";

// 補助アクション(取り消し・再試行など)
export const ghostButtonClass =
  "rounded-full border border-line bg-surface px-4 py-2 text-center text-sm font-medium disabled:opacity-50";

// テキストリンク
export const linkClass =
  "text-sm font-medium text-me-strong underline underline-offset-4";

// 入力欄
export const inputClass =
  "w-full rounded-xl border border-line bg-surface px-3 py-2 text-base";

// 状態バッジ(未確定・精算済みなど)。色は使う側で足す
export const badgeClass =
  "rounded-full px-2 py-0.5 text-xs font-bold whitespace-nowrap";

// 金額表示。桁が揃うよう等幅数字にする
export const amountClass = "tabular-nums font-bold";

// メンバー識別色。「自分=青緑 / 相手=菫」はアプリ全体で固定
export function memberColorClass(isSelf: boolean): string {
  return isSelf ? "bg-me" : "bg-partner";
}

// 一覧の行の左縁(誰が支払ったか)。household 読み込み前は無色
export function payerEdgeClass(isSelf: boolean | null): string {
  if (isSelf === null) {
    return "border-l-4 border-l-line";
  }
  return isSelf ? "border-l-4 border-l-me" : "border-l-4 border-l-partner";
}
