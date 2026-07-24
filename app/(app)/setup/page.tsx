import { requireSignedIn } from "@/lib/server-auth";

export default async function SetupPage() {
  await requireSignedIn(); // リソースレベル認証(ログイン必須・世帯所属は不要)
  return <main className="p-8">TODO: 世帯セットアップ(S-002)</main>;
}
