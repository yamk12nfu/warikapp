import { requireSignedIn } from "@/lib/server-auth";
import SettlementsClient from "./settlements-client";

export default async function SettlementsHistoryPage() {
  await requireSignedIn(); // リソースレベル認証
  return <SettlementsClient />;
}
