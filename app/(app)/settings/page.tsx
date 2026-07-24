import { requireSignedIn } from "@/lib/server-auth";
import { SignOutButton } from "@clerk/nextjs";

export default async function SettingsPage() {
  await requireSignedIn(); // リソースレベル認証
  return (
    <main className="p-8 space-y-6">
      <h1 className="text-xl font-bold">設定</h1>
      <p className="text-sm text-gray-500">
        TODO: 表示名変更・招待コード再発行(S-009 / Phase 4で実装)
      </p>
      <SignOutButton redirectUrl="/login">
        <button className="rounded border px-4 py-2 text-red-600">
          ログアウト
        </button>
      </SignOutButton>
    </main>
  );
}
