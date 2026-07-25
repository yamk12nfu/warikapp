import { requireSignedIn } from "@/lib/server-auth";
import ManualExpenseClient from "./manual-client";

export default async function NewManualPage() {
  await requireSignedIn(); // リソースレベル認証
  return <ManualExpenseClient />;
}
