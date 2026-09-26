import { requireSignedIn } from "@/lib/server-auth";
import { Suspense } from "react";
import HomeClient from "./home-client";

export default async function HomePage() {
  await requireSignedIn(); // リソースレベル認証(Clerk推奨)
  return (
    <Suspense fallback={<main className="p-8 text-muted">読み込み中…</main>}>
      <HomeClient />
    </Suspense>
  );
}
