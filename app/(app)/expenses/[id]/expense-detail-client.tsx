"use client";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { toUserMessage } from "@/lib/convex-error";
import { formatDateLabel, formatYen } from "@/lib/format";
import { calcAdvanceAmount, calcItemShareAmount } from "@/lib/settlement";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

// 支出詳細(S-005 / F-006)。品目・仕分け内訳・立て替え額・レシート画像を表示し、
// 編集(/expenses/[id]/edit)と削除の導線を置く。
// 精算済みの支出は閲覧のみ(サーバー側でも expenses.save / remove が拒否する)。

const badgeClass =
  "rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap";

const buttonClass =
  "flex-1 rounded-md border border-black/15 px-4 py-3 text-center text-sm font-medium disabled:opacity-50 dark:border-white/25";

export default function ExpenseDetailClient({
  expenseId,
}: {
  expenseId: string;
}) {
  const router = useRouter();
  // Convex側のJWT検証が完了するまでqueryを実行しない(Phase 3と同じ理由)
  const { isLoading, isAuthenticated } = useConvexAuth();
  const expense = useQuery(
    api.expenses.get,
    isAuthenticated ? { expenseId } : "skip",
  );
  // household は requireMember で throw するため、支出が読めてから呼ぶ
  const household = useQuery(api.couples.household, expense ? {} : "skip");
  const imageUrl = useQuery(
    api.expenses.getImageUrl,
    expense?.hasImage ? { expenseId } : "skip",
  );
  const removeExpense = useMutation(api.expenses.remove);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);

  async function handleRemove() {
    if (expense === undefined || expense === null) {
      return;
    }
    if (!window.confirm("この支出を削除します。よろしいですか?")) {
      return;
    }
    setError(null);
    setRemoving(true);
    try {
      await removeExpense({ expenseId: expense._id as Id<"expenses"> });
      router.replace("/");
      // 成功時は removing を解除しない(遷移の完了前に再送信できてしまうため)
    } catch (caught) {
      setError(toUserMessage(caught));
      setRemoving(false);
    }
  }

  if (isLoading) {
    return <main className="p-8 text-gray-500">読み込み中…</main>;
  }
  if (!isAuthenticated) {
    return null; // 未ログイン: proxyが/loginへ誘導する
  }
  if (expense === undefined) {
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

  const memberName = (memberId: string) => {
    if (household === undefined) {
      return "";
    }
    if (memberId === household.self._id) {
      return "あなた";
    }
    if (memberId === household.partner?._id) {
      return household.partner.displayName;
    }
    return "メンバー";
  };

  const advanceAmount = calcAdvanceAmount(expense.paidBy, expense.items);
  const payerName = memberName(expense.paidBy);
  const otherId =
    household === undefined
      ? null
      : expense.paidBy === household.self._id
        ? (household.partner?._id ?? null)
        : household.self._id;

  return (
    <main className="mx-auto w-full max-w-md space-y-6 p-6">
      <div>
        <Link href="/" className="text-sm text-blue-600 underline">
          ← ホーム
        </Link>
        <h1 className="mt-2 text-xl font-bold">
          {expense.storeName ?? expense.items[0]?.name ?? "(名称なし)"}
        </h1>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {expense.status === "draft" && (
            <span
              className={`${badgeClass} bg-amber-100 text-amber-900 dark:bg-amber-900 dark:text-amber-100`}
            >
              未確定
            </span>
          )}
          {expense.settled && (
            <span
              className={`${badgeClass} bg-black/10 text-gray-600 dark:bg-white/15 dark:text-gray-300`}
            >
              精算済み
            </span>
          )}
          <span className="text-sm text-gray-500">
            {formatDateLabel(expense.purchasedAt)}
          </span>
          <span className="text-sm text-gray-500">
            {payerName}が支払い
          </span>
        </div>
      </div>

      {expense.hasImage && (
        <section className="space-y-1">
          <h2 className="text-sm font-semibold">レシート画像</h2>
          {imageUrl == null ? (
            <p className="text-sm text-gray-500">読み込み中…</p>
          ) : (
            // タップで拡大(新しいタブで原寸を開く)。Convexの署名付きURLなので
            // next/image のリモートホスト設定を増やさず素の img を使う
            <a href={imageUrl} target="_blank" rel="noreferrer">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={imageUrl}
                alt="レシート"
                className="max-h-48 rounded-lg border border-black/15 object-contain dark:border-white/25"
              />
            </a>
          )}
        </section>
      )}

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">品目と仕分け</h2>
        <ul className="space-y-2">
          {expense.items.map((item, index) => (
            <li
              key={index}
              className="rounded-lg border border-black/15 p-3 dark:border-white/25"
            >
              <div className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 truncate font-medium">
                  {item.name}
                  {item.quantity > 1 && (
                    <span className="text-sm text-gray-500">
                      {" "}
                      × {item.quantity}
                    </span>
                  )}
                </span>
                <span className="whitespace-nowrap font-bold">
                  {formatYen(item.price * item.quantity)}
                </span>
              </div>
              <ul className="mt-1 space-y-0.5 text-xs text-gray-500">
                {item.shares.map((share) => (
                  <li key={share.memberId}>
                    {memberName(share.memberId)} {share.ratioPercent}% ・{" "}
                    {formatYen(calcItemShareAmount(item, share.memberId))}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-2 rounded-lg border border-black/15 p-4 dark:border-white/25">
        <div className="flex items-baseline justify-between">
          <span className="text-sm text-gray-500">合計</span>
          <span className="text-lg font-bold">
            {formatYen(expense.totalAmount)}
          </span>
        </div>
        <div className="flex items-baseline justify-between">
          <span className="text-sm text-gray-500">立て替え額</span>
          <span className="text-sm">
            {advanceAmount === 0 || otherId === null
              ? "なし"
              : `${payerName} → ${memberName(otherId)} ${formatYen(advanceAmount)}`}
          </span>
        </div>
      </section>

      {expense.settled && (
        <p className="text-sm text-gray-500">
          精算済みの記録は変更できません
        </p>
      )}
      {error !== null && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}

      <div className="flex gap-3">
        {expense.settled ? (
          <button type="button" disabled className={buttonClass}>
            編集
          </button>
        ) : (
          <Link href={`/expenses/${expense._id}/edit`} className={buttonClass}>
            編集
          </Link>
        )}
        <button
          type="button"
          onClick={handleRemove}
          disabled={expense.settled || removing}
          className={`${buttonClass} text-red-600`}
        >
          {removing ? "削除中…" : "削除"}
        </button>
      </div>
    </main>
  );
}
