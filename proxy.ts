import { clerkMiddleware } from "@clerk/nextjs/server";

// Next.js 16 の Proxy(旧 middleware)。/login 以外は未ログインなら /login へ。
// createRouteMatcher は Clerk v7 で非推奨のため pathname 判定を使う。
const isPublicPath = (pathname: string) =>
  pathname === "/login" || pathname.startsWith("/login/");

// 本番では「このアプリのオリジンから来たトークンだけを受け付ける」ことを
// Clerkが推奨している。指定しないと、同じルートドメイン配下の別サブドメインに
// 渡ったcookieでもトークン検証が通ってしまう(cookie leaking → CSRF)。
// Vercelの環境変数 CLERK_AUTHORIZED_PARTIES に本番URLを入れる
// (複数あればカンマ区切り。例: "https://warikapp.example.com")。
// 未設定なら指定なし = 従来どおりの挙動。開発では設定しなくてよい。
//
// ⚠️ これが効くのは **このProxyを通るリクエストだけ**。画面のデータは
// ConvexProviderWithClerk が Clerk のJWTを直接Convexへ送る経路で流れており、
// Convex側(convex/auth.config.ts)は issuer と applicationID しか検証しない
// ため、azp の検査は掛からない。サブドメインからの迂回を塞ぐには
// **Clerkダッシュボードの Allowed Subdomains** も設定すること
// (docs/deployment.md §1-5)。ここは多層防御の1枚目という位置づけ。
const authorizedParties = parseAuthorizedParties(
  process.env.CLERK_AUTHORIZED_PARTIES,
);

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
function parseAuthorizedParties(raw: string | undefined): string[] {
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
  if (entries.length > 0 && origins.length === 0) {
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

export default clerkMiddleware(
  async (auth, req) => {
    if (isPublicPath(req.nextUrl.pathname)) {
      return;
    }
    const { userId, redirectToSignIn } = await auth();
    if (userId === null) {
      // returnBackUrl で「復帰後は元のページへ」(要件 F-001)を満たす
      return redirectToSignIn({ returnBackUrl: req.url });
    }
  },
  {
    signInUrl: "/login",
    ...(authorizedParties.length > 0 ? { authorizedParties } : {}),
  },
);

export const config = {
  // Clerk公式推奨のmatcher: 静的アセットの拡張子のみ除外する
  // (「.を含むパス全除外」だと /expenses/foo.bar 等の動的ルートが保護漏れになる)
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // 動的セグメントを持つルートは明示指定し、拡張子風のURL
    // (例: /expenses/foo.css)も必ずclerkMiddlewareを通す
    "/expenses/:path*",
    "/(api|trpc)(.*)",
  ],
};
