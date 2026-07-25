import { requireSignedIn } from "@/lib/server-auth";

export default async function ExpenseDetailPage() {
  await requireSignedIn(); // リソースレベル認証
  return <main className="p-8">TODO: 支出詳細・編集(S-005)</main>;
}
