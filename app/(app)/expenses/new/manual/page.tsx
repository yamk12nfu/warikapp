import { requireSignedIn } from "@/lib/server-auth";

export default async function NewManualPage() {
  await requireSignedIn(); // リソースレベル認証
  return <main className="p-8">TODO: 手入力登録(S-006)</main>;
}
