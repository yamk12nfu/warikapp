import { requireSignedIn } from "@/lib/server-auth";
import SetupClient from "./setup-client";

// 招待URL(/setup?code=XXXXXXXX)で開かれたときはコードを初期値として渡す
export default async function SetupPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  await requireSignedIn(); // リソースレベル認証(ログイン必須・世帯所属は不要)
  const { code } = await searchParams;
  return <SetupClient initialCode={typeof code === "string" ? code : ""} />;
}
