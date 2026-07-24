import { requireSignedIn } from "@/lib/server-auth";
import { ReactNode } from "react";

// 保護ルート群の追加防御。認証の本体は各ページ冒頭の requireSignedIn()
// (リソースレベル認証)と proxy.ts。matcherで全アプリルートが
// clerkMiddleware を通るため、ここで auth() が例外になる経路はない。
export default async function ProtectedLayout({
  children,
}: {
  children: ReactNode;
}) {
  await requireSignedIn();
  return <>{children}</>;
}
