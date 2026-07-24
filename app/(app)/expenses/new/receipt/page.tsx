import { requireSignedIn } from "@/lib/server-auth";

export default async function NewReceiptPage() {
  await requireSignedIn(); // リソースレベル認証
  return <main className="p-8">TODO: レシート登録(S-004)</main>;
}
