import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

// リソースレベル認証(Clerk推奨)。各保護ページ・レイアウトの冒頭で呼ぶ。
// layoutはクライアント遷移時に再実行されないことがあるため、
// ページ側のチェックが本体で、layout/proxyは追加防御という位置づけ。
export async function requireSignedIn() {
  const { userId } = await auth();
  if (userId === null) {
    redirect("/login");
  }
}
