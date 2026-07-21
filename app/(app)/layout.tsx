import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { ReactNode } from "react";

// 保護ルート群のリソースレベル認証(Clerk v7推奨)。
// proxy.tsのmatcherは静的アセット拡張子を除外するため、拡張子付きURL
// (例: /expenses/foo.css)がProxyをすり抜けてもここで確実に弾く防衛線。
export default async function ProtectedLayout({
  children,
}: {
  children: ReactNode;
}) {
  let userId: string | null = null;
  try {
    ({ userId } = await auth());
  } catch {
    // proxy(clerkMiddleware)を通らない経路では auth() が例外を投げる。
    // 認証を確認できない以上、未ログインとして扱う(userId は null のまま)
  }
  if (userId === null) {
    redirect("/login");
  }
  return <>{children}</>;
}
