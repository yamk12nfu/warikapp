import { requireSignedIn } from "@/lib/server-auth";
import ExpenseDetailClient from "./expense-detail-client";

export default async function ExpenseDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireSignedIn(); // リソースレベル認証
  const { id } = await params;
  // IDの形式・所有者の検証はConvex側(expenses.get)で行う
  return <ExpenseDetailClient expenseId={id} />;
}
