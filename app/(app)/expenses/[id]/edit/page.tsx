import { requireSignedIn } from "@/lib/server-auth";
import ExpenseEditClient from "./expense-edit-client";

export default async function ExpenseEditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireSignedIn(); // リソースレベル認証
  const { id } = await params;
  // IDの形式・所有者・精算済みの検証はConvex側(expenses.get / save)で行う
  return <ExpenseEditClient expenseId={id} />;
}
