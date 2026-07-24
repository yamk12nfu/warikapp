import { requireSignedIn } from "@/lib/server-auth";

export default async function SettlementsHistoryPage() {
  await requireSignedIn(); // リソースレベル認証
  return <main className="p-8">TODO: 精算履歴(S-008)</main>;
}
