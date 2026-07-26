"use client";

import ExpenseEditor, {
  type ExpenseFormValue,
} from "@/components/ExpenseEditor";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

// 支出の編集(S-005 / F-006)。仕分けUI(ExpenseEditor)をそのまま再利用し、
// expenses.save を expenseId 付きで呼ぶ。
// 精算済みは編集させない(サーバー側の expenses.save でも拒否する)。
//
// ドラフト(レシート読み取りの途中で離脱したもの)を開いた場合は、この画面が
// 「確定」の導線を兼ねる(保存すると status を confirmed にする)。
// ここで確定できないと、ホームの「未確定」バッジから再開しても確定できない。

export default function ExpenseEditClient({
  expenseId,
}: {
  expenseId: string;
}) {
  const router = useRouter();
  // Convex側のJWT検証が完了するまでqueryを実行しない(Phase 3と同じ理由)
  const { isLoading, isAuthenticated } = useConvexAuth();
  const member = useQuery(
    api.couples.currentMember,
    isAuthenticated ? {} : "skip",
  );
  // expenses.get / household は requireMember で throw するため、
  // 世帯所属が確定してから呼ぶ(未所属のままだと画面がエラーで落ちる)
  const expense = useQuery(api.expenses.get, member ? { expenseId } : "skip");
  const household = useQuery(api.couples.household, member ? {} : "skip");
  const saveExpense = useMutation(api.expenses.save);

  useEffect(() => {
    // 認証確立後にnull = 本当に世帯未所属
    if (isAuthenticated && member === null) {
      router.replace("/setup");
    }
  }, [isAuthenticated, member, router]);

  async function handleSubmit(value: ExpenseFormValue) {
    if (expense === undefined || expense === null) {
      return;
    }
    await saveExpense({
      expenseId: expense._id as Id<"expenses">,
      paidBy: value.paidBy as Id<"members">,
      storeName: value.storeName.trim() === "" ? undefined : value.storeName,
      purchasedAt: value.purchasedAt,
      items: value.items.map((item) => ({
        ...item,
        shares: item.shares.map((share) => ({
          ...share,
          memberId: share.memberId as Id<"members">,
        })),
      })),
      // 由来(source)は更新時に変えない。
      // ドラフトはこの保存で確定させる(確定済みはそのまま確定のまま)
      status: "confirmed",
    });
    router.replace(`/expenses/${expense._id}`);
  }

  if (isLoading) {
    return <main className="p-8 text-gray-500">読み込み中…</main>;
  }
  if (!isAuthenticated) {
    return null; // 未ログイン: proxyが/loginへ誘導する
  }
  if (member === undefined) {
    return <main className="p-8 text-gray-500">読み込み中…</main>;
  }
  if (member === null) {
    return null; // 世帯未所属: /setupへ誘導中
  }
  if (expense === undefined || household === undefined) {
    return <main className="p-8 text-gray-500">読み込み中…</main>;
  }
  if (expense === null) {
    // 他世帯・削除済み・存在しないIDはすべて同じ表示にする(存在を漏らさない)
    return (
      <main className="mx-auto w-full max-w-md space-y-4 p-6">
        <p className="text-sm">支出が見つかりません</p>
        <Link href="/" className="block text-sm text-blue-600 underline">
          ホームへ戻る
        </Link>
      </main>
    );
  }
  if (expense.settled) {
    return (
      <main className="mx-auto w-full max-w-md space-y-4 p-6">
        <p className="text-sm">精算済みの記録は変更できません</p>
        <Link
          href={`/expenses/${expense._id}`}
          className="block text-sm text-blue-600 underline"
        >
          支出の詳細へ戻る
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-md space-y-5 p-6">
      <div>
        <Link
          href={`/expenses/${expense._id}`}
          className="text-sm text-blue-600 underline"
        >
          ← 詳細に戻る
        </Link>
        <h1 className="mt-2 text-xl font-bold">
          {expense.status === "draft" ? "下書きを確認" : "支出を編集"}
        </h1>
        {expense.status === "draft" && (
          <p className="mt-1 text-sm text-gray-500">
            確定するとホームの未精算差額に反映されます。
          </p>
        )}
      </div>

      <ExpenseEditor
        self={household.self}
        partner={household.partner}
        initialValue={{
          paidBy: expense.paidBy,
          storeName: expense.storeName ?? "",
          purchasedAt: expense.purchasedAt,
          items: expense.items,
        }}
        submitLabel={
          expense.status === "draft" ? "この支出を確定する" : "変更を保存する"
        }
        submittingLabel={expense.status === "draft" ? "確定中…" : "保存中…"}
        onSubmit={handleSubmit}
      />
    </main>
  );
}
