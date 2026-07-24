import { requireSignedIn } from "@/lib/server-auth";

export default async function SettlementPage() {
  await requireSignedIn(); // リソースレベル認証
  return <main className="p-8">TODO: 精算確認・実行(S-007)</main>;
}
