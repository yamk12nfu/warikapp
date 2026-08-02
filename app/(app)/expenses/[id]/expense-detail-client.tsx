"use client";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { toUserMessage } from "@/lib/convex-error";
import { formatDateLabel, formatYen } from "@/lib/format";
import { calcAdvanceAmount, calcItemShareAmount } from "@/lib/settlement";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

// 支出詳細(S-005 / F-006)。品目・仕分け内訳・立て替え額・レシート画像を表示し、
// 編集(/expenses/[id]/edit)と削除の導線を置く。
// 精算済みの支出は閲覧のみ(サーバー側でも expenses.save / remove が拒否する)。

const badgeClass =
  "rounded-full px-2 py-0.5 text-xs font-bold whitespace-nowrap";

const buttonClass =
  "flex-1 rounded-full border border-line bg-surface px-4 py-3 text-center text-sm font-medium disabled:opacity-50";

export default function ExpenseDetailClient({
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
  const imageUrl = useQuery(
    api.expenses.getImageUrl,
    expense?.hasImage ? { expenseId } : "skip",
  );
  const removeExpense = useMutation(api.expenses.remove);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);

  useEffect(() => {
    // 認証確立後にnull = 本当に世帯未所属
    if (isAuthenticated && member === null) {
      router.replace("/setup");
    }
  }, [isAuthenticated, member, router]);

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
    return <main className="p-8 text-muted">読み込み中…</main>;
  }
  if (!isAuthenticated) {
    return null; // 未ログイン: proxyが/loginへ誘導する
  }
  if (member === undefined) {
    return <main className="p-8 text-muted">読み込み中…</main>;
  }
  if (member === null) {
    return null; // 世帯未所属: /setupへ誘導中
  }
  // 支払者名と立て替え額の相手を household から引くため、揃うまで待つ
  // (先に出すと名前が空欄になり、立て替え額も「なし」と誤って表示される)
  if (expense === undefined || household === undefined) {
    return <main className="p-8 text-muted">読み込み中…</main>;
  }
  if (expense === null) {
    // 他世帯・削除済み・存在しないIDはすべて同じ表示にする(存在を漏らさない)
    return (
      <main className="mx-auto w-full max-w-md space-y-4 p-6">
        <p className="text-sm">支出が見つかりません</p>
        <Link href="/" className="block text-sm font-medium text-me-strong underline underline-offset-4">
          ホームへ戻る
        </Link>
      </main>
    );
  }

  const memberName = (memberId: string) => {
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
  // 立て替えの相手(支払者でない側)。パートナー未参加なら立て替えは発生しない
  const otherId =
    expense.paidBy === household.self._id
      ? (household.partner?._id ?? null)
      : household.self._id;

  return (
    <main className="mx-auto w-full max-w-md space-y-6 p-6">
      <div>
        <Link href="/" className="text-sm font-medium text-me-strong underline underline-offset-4">
          ← ホーム
        </Link>
        <h1 className="mt-2 text-xl font-bold">
          {expense.storeName ?? expense.items[0]?.name ?? "(名称なし)"}
        </h1>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {expense.status === "draft" && (
            <span className={`${badgeClass} bg-warn-soft text-warn-strong`}>
              未確定
            </span>
          )}
          {expense.settled && (
            <span className={`${badgeClass} bg-line text-muted`}>
              精算済み
            </span>
          )}
          <span className="text-sm text-muted">
            {formatDateLabel(expense.purchasedAt)}
          </span>
          <span className="text-sm text-muted">
            {payerName}が支払い
          </span>
        </div>
      </div>

      {expense.hasImage && (
        <section className="space-y-1">
          <h2 className="text-sm font-semibold">レシート画像</h2>
          {imageUrl === undefined ? (
            <p className="text-sm text-muted">読み込み中…</p>
          ) : imageUrl === null ? (
            // 読み込み中(undefined)と区別する。null は保存先から画像が消えた場合
            <p className="text-sm text-muted">画像を表示できませんでした</p>
          ) : (
            // タップで拡大(新しいタブで原寸を開く)。Convexの署名付きURLなので
            // next/image のリモートホスト設定を増やさず素の img を使う
            <a href={imageUrl} target="_blank" rel="noreferrer">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={imageUrl}
                alt="レシート"
                className="max-h-48 rounded-2xl border border-line object-contain"
              />
            </a>
          )}
        </section>
      )}

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">品目と仕分け</h2>
        <ul className="space-y-2">
          {expense.items.map((item, index) => (
            <li key={index} className="rounded-2xl bg-surface p-3 shadow-card">
              <div className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 truncate font-bold">
                  {item.name}
                  {item.quantity > 1 && (
                    <span className="text-sm font-medium text-muted">
                      {" "}
                      × {item.quantity}
                    </span>
                  )}
                </span>
                <span className="whitespace-nowrap font-bold tabular-nums">
                  {formatYen(item.price * item.quantity)}
                </span>
              </div>
              <ul className="mt-1 space-y-0.5 text-xs text-muted">
                {item.shares.map((share) => (
                  <li key={share.memberId} className="flex items-center gap-1.5">
                    {/* メンバー識別色(自分=青緑/相手=菫)。ホームの天秤バーと同じ */}
                    <span
                      aria-hidden
                      className={`size-2 rounded-full ${
                        share.memberId === household.self._id
                          ? "bg-me"
                          : "bg-partner"
                      }`}
                    />
                    {memberName(share.memberId)} {share.ratioPercent}% ・{" "}
                    {formatYen(calcItemShareAmount(item, share.memberId))}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-2 rounded-2xl bg-surface p-4 shadow-card">
        <div className="flex items-baseline justify-between">
          <span className="text-sm text-muted">合計</span>
          <span className="text-lg font-bold tabular-nums">
            {formatYen(expense.totalAmount)}
          </span>
        </div>
        <div className="flex items-baseline justify-between">
          <span className="text-sm text-muted">立て替え額</span>
          <span className="text-sm">
            {advanceAmount === 0 || otherId === null
              ? "なし"
              : `${payerName} → ${memberName(otherId)} ${formatYen(advanceAmount)}`}
          </span>
        </div>
      </section>

      {expense.settled && (
        <p className="text-sm text-muted">
          精算済みの記録は変更できません
        </p>
      )}
      {error !== null && (
        <p role="alert" className="text-sm text-danger">
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
          className={`${buttonClass} text-danger`}
        >
          {removing ? "削除中…" : "削除"}
        </button>
      </div>
    </main>
  );
}
