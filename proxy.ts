import { clerkMiddleware } from "@clerk/nextjs/server";

// Next.js 16 の Proxy(旧 middleware)。/login 以外は未ログインなら /login へ。
// createRouteMatcher は Clerk v7 で非推奨のため pathname 判定を使う。
const isPublicPath = (pathname: string) =>
  pathname === "/login" || pathname.startsWith("/login/");

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
  { signInUrl: "/login" },
);

export const config = {
  // Clerk公式推奨のmatcher: 静的アセットの拡張子のみ除外する
  // (「.を含むパス全除外」だと /expenses/foo.bar 等の動的ルートが保護漏れになる)
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
