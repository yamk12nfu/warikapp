"use client";

import ExpenseEditor, {
  createInitialItem,
  type ExpenseFormValue,
} from "@/components/ExpenseEditor";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { todayLocalDate } from "@/lib/date";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

// 手入力での支出登録(S-006 / F-005)。最短「品目名+金額」だけで確定できる
// (支払者=本人、購入日=当日、負担区分=折半がデフォルト)。
// 内部的には品目1件の支出として expenses.save を呼ぶ。

export default function ManualExpenseClient() {
  const router = useRouter();
  // Convex側のJWT検証が完了するまでqueryを実行しない(Phase 3と同じ理由)
  const { isLoading, isAuthenticated } = useConvexAuth();
  const member = useQuery(
    api.couples.currentMember,
    isAuthenticated ? {} : "skip",
  );
  // household は requireMember で throw するため、所属済みが確定してから呼ぶ
  const household = useQuery(api.couples.household, member ? {} : "skip");
  const saveExpense = useMutation(api.expenses.save);

  useEffect(() => {
    if (isAuthenticated && member === null) {
      router.replace("/setup");
    }
  }, [isAuthenticated, member, router]);

  async function handleSubmit(value: ExpenseFormValue) {
    await saveExpense({
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
      source: "manual",
      status: "confirmed",
    });
    router.replace("/");
  }

  // 未認証の判定を query の読み込み判定より先に行う(未認証では query が "skip" で
  // undefined のまま止まるため、順序を逆にすると「読み込み中…」から抜けられない)
  if (isLoading) {
    return <main className="p-8 text-muted">読み込み中…</main>;
  }
  if (!isAuthenticated) {
    return null; // 未ログイン: proxyが/loginへ誘導する
  }
  if (member === undefined || (member !== null && household === undefined)) {
    return <main className="p-8 text-muted">読み込み中…</main>;
  }
  if (member === null || household === undefined) {
    return null; // 世帯未所属: /setupへ誘導中
  }

  return (
    <main className="mx-auto w-full max-w-md space-y-5 p-6">
      <div>
        <h1 className="text-xl font-bold">支出を手入力</h1>
        <p className="mt-1 text-sm text-muted">
          品目名と金額だけで登録できます。負担区分は初期値が「折半」です。
        </p>
      </div>

      <ExpenseEditor
        self={household.self}
        partner={household.partner}
        initialValue={{
          paidBy: household.self._id,
          storeName: "",
          purchasedAt: todayLocalDate(),
          items: [
            createInitialItem(
              household.self._id,
              household.partner === null ? null : household.partner._id,
            ),
          ],
        }}
        submitLabel="この支出を登録する"
        submittingLabel="登録中…"
        onSubmit={handleSubmit}
      />

      <Link href="/" className="block text-sm font-medium text-me-strong underline underline-offset-4">
        ホームへ戻る
      </Link>
    </main>
  );
}
