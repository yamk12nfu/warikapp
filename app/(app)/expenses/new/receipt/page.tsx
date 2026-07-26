import { requireSignedIn } from "@/lib/server-auth";
import ReceiptExpenseClient from "./receipt-client";

export default async function NewReceiptPage() {
  await requireSignedIn(); // リソースレベル認証
  return <ReceiptExpenseClient />;
}
