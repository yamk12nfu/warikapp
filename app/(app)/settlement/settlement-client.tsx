"use client";

import { api } from "@/convex/_generated/api";
import { toUserMessage } from "@/lib/convex-error";
import { formatDateLabel, formatYen } from "@/lib/format";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

// 精算確認・実行(S-007 / F-007)。対象の未精算支出と内訳を確認して精算する。
// 差額はサーバー側(settlements.execute)で計算し直すため、ここの表示は確認用。

const MAX_MEMO_LENGTH = 100;

export default function SettlementClient() {
  const router = useRouter();
  // Convex側のJWT検証が完了するまでqueryを実行しない(Phase 3と同じ理由)
  const { isLoading, isAuthenticated } = useConvexAuth();
  const member = useQuery(
    api.couples.currentMember,
    isAuthenticated ? {} : "skip",
  );
  // pending / household は requireMember で throw するため、所属確定後に呼ぶ
  const pending = useQuery(api.settlements.pending, member ? {} : "skip");
  const household = useQuery(api.couples.household, member ? {} : "skip");
  const execute = useMutation(api.settlements.execute);
  const [memo, setMemo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    // 認証確立後にnull = 本当に世帯未所属
    if (isAuthenticated && member === null) {
      router.replace("/setup");
    }
  }, [isAuthenticated, member, router]);

  async function handleExecute() {
    if (pending === undefined) {
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await execute({
        memo: memo.trim() === "" ? undefined : memo,
        // 画面に出ている内容。サーバーは金額の決定にはこれを使わず、
        // 計算し直した結果と食い違ったら実行を中止する(V-702)
        expectedAmount: pending.amount,
        expectedFromMemberId: pending.fromMemberId,
        expectedExpenseCount: pending.expenseCount,
      });
      // 記録できたことが分かるよう履歴へ送る。ホームの差額は0に戻る
      router.replace("/settlements");
      // 成功時は submitting を解除しない(V-702: 遷移前の二重送信を防ぐ)
    } catch (caught) {
      setError(toUserMessage(caught));
      setSubmitting(false);
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
  // 支払者名を household から引くため、揃うまで待つ
  if (pending === undefined || household === undefined) {
    return <main className="p-8 text-muted">読み込み中…</main>;
  }

  // 支出の行に出す名前(「○○が支払い」)。ホームの一覧と同じ書き方に揃える
  const memberName = (memberId: string | null) => {
    if (memberId === household.self._id) {
      return "あなた";
    }
    if (memberId === household.partner?._id) {
      return household.partner.displayName;
    }
    return "メンバー";
  };

  // 差額の説明文に出す名前。相手には「さん」を付ける(ホームの表示と揃える)
  const memberNameWithHonorific = (memberId: string | null) =>
    memberId === household.self._id || memberId === null
      ? memberName(memberId)
      : `${memberName(memberId)}さん`;

  const hasDraft = pending.draftCount > 0;
  const canExecute =
    pending.expenseCount > 0 && !hasDraft && household.partner !== null;

  return (
    <main className="mx-auto w-full max-w-md space-y-6 p-6">
      <div>
        <Link href="/" className="text-sm font-medium text-me-strong underline underline-offset-4">
          ← ホーム
        </Link>
        <h1 className="mt-2 text-xl font-bold">精算</h1>
      </div>

      <section className="rounded-2xl bg-surface p-4 shadow-card">
        <p className="text-sm text-muted">未精算差額</p>
        <p className="text-2xl font-bold tabular-nums">
          {formatYen(pending.amount)}
        </p>
        <p className="mt-1 text-xs text-muted">
          {pending.amount === 0
            ? pending.expenseCount === 0
              ? "未精算の支出はありません"
              : "貸し借りはありません"
            : `${memberNameWithHonorific(
                pending.fromMemberId,
              )}が ${memberNameWithHonorific(pending.toMemberId)}に 支払います`}
        </p>
      </section>

      {household.partner === null && (
        <p className="text-sm text-warn-strong">
          パートナーが参加してから精算できます
        </p>
      )}

      {hasDraft && (
        <p role="alert" className="text-sm text-warn-strong">
          未確定のレシートが{pending.draftCount}件あります。
          確定または削除してから精算してください
        </p>
      )}

      {pending.truncated && (
        <p className="text-sm text-muted">
          未精算の支出が多いため、古いほうから{pending.expenseCount}
          件を今回の対象にしています。残りは次回の精算に回ります
        </p>
      )}

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">
          精算の対象({pending.expenseCount}件)
        </h2>
        {pending.expenses.length === 0 ? (
          <p className="text-sm text-muted">精算する支出がありません</p>
        ) : (
          <ul className="space-y-2">
            {pending.expenses.map((expense) => (
              <li
                key={expense._id}
                className="rounded-2xl bg-surface p-3 shadow-card"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 truncate font-bold">
                    {expense.title}
                  </span>
                  <span className="whitespace-nowrap font-bold tabular-nums">
                    {formatYen(expense.totalAmount)}
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted">
                  {formatDateLabel(expense.purchasedAt)} ・{" "}
                  {memberName(expense.paidBy)}が支払い ・ 立て替え{" "}
                  {formatYen(expense.advanceAmount)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-1">
        <label htmlFor="memo" className="block text-sm font-semibold">
          メモ(任意)
        </label>
        <input
          id="memo"
          type="text"
          value={memo}
          maxLength={MAX_MEMO_LENGTH}
          onChange={(event) => setMemo(event.target.value)}
          placeholder="例: 6月分"
          className="w-full rounded-xl border border-line bg-surface px-3 py-2"
        />
        <p className="text-right text-xs text-muted">
          {memo.length}/{MAX_MEMO_LENGTH}
        </p>
      </section>

      {error !== null && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={handleExecute}
        disabled={!canExecute || submitting}
        className="w-full rounded-full bg-me px-4 py-3 text-sm font-bold text-white disabled:opacity-50"
      >
        {submitting ? "精算中…" : "精算する"}
      </button>
      <p className="text-xs text-muted">
        実際の送金はアプリの外(現金・送金アプリなど)で行ってください
      </p>
    </main>
  );
}
