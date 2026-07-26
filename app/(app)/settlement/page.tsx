import { requireSignedIn } from "@/lib/server-auth";
import SettlementClient from "./settlement-client";

export default async function SettlementPage() {
  await requireSignedIn(); // リソースレベル認証
  return <SettlementClient />;
}
