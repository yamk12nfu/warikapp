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
const authorizedParties = (process.env.CLERK_AUTHORIZED_PARTIES ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter((origin) => origin !== "");

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
