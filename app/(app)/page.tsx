import { requireSignedIn } from "@/lib/server-auth";
import HomeClient from "./home-client";

export default async function HomePage() {
  await requireSignedIn(); // リソースレベル認証(Clerk推奨)
  return <HomeClient />;
}
