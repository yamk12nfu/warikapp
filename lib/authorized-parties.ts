// Clerkは azp と**完全一致**で判定する(@clerk/backend の verifyToken)。
// 末尾スラッシュ・大文字・明示的な :443 のような表記ゆれがあるだけで
// 誰もログインできなくなるので、URLとして解釈してオリジンに正規化する。
//
// http / https だけを受ける。new URL() 単体はオリジンの検証にならず、
// `ftp://…` はそのまま通り、`file:` / `data:` / `javascript:` は "null" という
// オリジンになり、`blob:https://…` は中のHTTPSオリジンとして通ってしまう。
// 許可リストに載せてよいのはブラウザが azp に入れる http(s) オリジンだけ。
//
// 受け付けられなかった値は捨てるが、黙って落とすと「設定したのに効いていない」に
// 気づけないのでログに残す(Vercelの実行ログに出る)。
// 1つも残らなかった場合は authorizedParties を渡さない = 検査なしに戻る
// (中途半端な許可リストで全員を締め出すより、元の挙動に倒す)。
export function parseAuthorizedParties(raw: string | undefined): string[] {
  const entries = (raw ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
  const origins: string[] = [];
  for (const entry of entries) {
    const origin = toHttpOrigin(entry);
    if (origin === null) {
      console.warn(
        `CLERK_AUTHORIZED_PARTIES: http(s)のオリジンとして解釈できない値を無視しました: ${entry}`,
      );
      continue;
    }
    origins.push(origin);
  }
  // 判定には entries ではなく raw を使う。","(区切り文字だけ)のような値は
  // entries が空になるので、entries を見ると「設定はしたのに警告も出ない」まま
  // 検査なしに倒れてしまう
  if ((raw ?? "").trim() !== "" && origins.length === 0) {
    console.warn(
      "CLERK_AUTHORIZED_PARTIES: 有効なオリジンが1つもないため、許可オリジンの検査を行いません",
    );
  }
  return origins;
}

function toHttpOrigin(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null; // スキームが無い("example.com" など)場合もここに来る
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return null;
  }
  return url.origin;
}
