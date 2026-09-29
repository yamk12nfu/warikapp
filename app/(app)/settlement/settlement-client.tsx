"use client";

import { api } from "@/convex/_generated/api";
import { useToast } from "@/components/Toast";
import { toUserMessage } from "@/lib/convex-error";
import { formatDateLabel, formatYen } from "@/lib/format";
import {
  cardClass,
  inputClass,
  linkClass,
  primaryButtonClass,
  secondaryButtonClass,
} from "@/lib/ui";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

// 精算(S-007 / F-007)。確認待ちが無ければ対象を確認して開始し、あれば
// 開始者は取り下げ、相手は確認か差し戻しを選ぶ。
// 差額はサーバー側(settlements.start)で計算し直すため、ここの表示は確認用。

const MAX_MEMO_LENGTH = 100;

export default function SettlementClient() {
  const router = useRouter();
  const { show } = useToast();
  // Convex側のJWT検証が完了するまでqueryを実行しない(Phase 3と同じ理由)
  const { isLoading, isAuthenticated } = useConvexAuth();
  const member = useQuery(
    api.couples.currentMember,
    isAuthenticated ? {} : "skip",
  );
  // current / household は requireMember で throw するため、所属確定後に呼ぶ
  const screen = useQuery(api.settlements.current, member ? {} : "skip");
  const household = useQuery(api.couples.household, member ? {} : "skip");
  const start = useMutation(api.settlements.start);
  const confirm = useMutation(api.settlements.confirm);
  const release = useMutation(api.settlements.release);
  const [memo, setMemo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (isAuthenticated && member === null) {
      router.replace("/setup");
    }
  }, [isAuthenticated, member, router]);

  async function handleStart() {
    if (screen === undefined || screen.phase !== "open") {
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const result = await start({
        memo: memo.trim() === "" ? undefined : memo,
        expectedAmount: screen.summary.amount,
        expectedFromMemberId: screen.summary.fromMemberId,
        expectedExpenseCount: screen.summary.expenseCount,
      });
      if (result.kind === "pending") {
        show("確認依頼を送りました");
        router.replace("/");
      } else {
        show("精算を記録しました");
        router.replace("/settlements");
      }
    } catch (caught) {
      setError(toUserMessage(caught));
      setSubmitting(false);
    }
  }

  async function handleConfirm() {
    if (screen === undefined || screen.phase !== "pending") {
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await confirm({ settlementId: screen.pending.settlementId });
      show("精算を完了しました");
      router.replace("/settlements");
    } catch (caught) {
      setError(toUserMessage(caught));
      setSubmitting(false);
    }
  }

  async function handleRelease() {
    if (screen === undefined || screen.phase !== "pending") {
      return;
    }
    if (
      !window.confirm(
        screen.pending.viewerRole === "starter"
          ? "この精算を取り下げます。対象の支出は未精算に戻ります。よろしいですか?"
          : "この精算を差し戻します。対象の支出は未精算に戻ります。よろしいですか?",
      )
    ) {
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await release({ settlementId: screen.pending.settlementId });
      show(
        screen.pending.viewerRole === "starter"
          ? "精算を取り下げました"
          : "精算を差し戻しました",
      );
      router.replace("/");
    } catch (caught) {
      setError(toUserMessage(caught));
      setSubmitting(false);
    }
  }

  if (isLoading) {
    return <main className="p-8 text-muted">読み込み中…</main>;
  }
  if (!isAuthenticated) {
    return null;
  }
  if (member === undefined) {
    return <main className="p-8 text-muted">読み込み中…</main>;
  }
  if (member === null) {
    return null;
  }
  if (screen === undefined || household === undefined) {
    return <main className="p-8 text-muted">読み込み中…</main>;
  }

  const memberName = (memberId: string | null) => {
    if (memberId === household.self._id) {
      return "あなた";
    }
    if (memberId === household.partner?._id) {
      return household.partner.displayName;
    }
    return "メンバー";
  };
  const memberNameWithHonorific = (memberId: string | null) =>
    memberId === household.self._id || memberId === null
      ? memberName(memberId)
      : `${memberName(memberId)}さん`;
  const isOpen = screen.phase === "open";
  const amount = isOpen ? screen.summary.amount : screen.pending.amount;
  const fromMemberId = isOpen
    ? screen.summary.fromMemberId
    : screen.pending.fromMemberId;
  const toMemberId = isOpen
    ? screen.summary.toMemberId
    : screen.pending.toMemberId;
  const expenseCount = isOpen
    ? screen.summary.expenseCount
    : screen.pending.expenseCount;
  const draftCount = isOpen ? screen.summary.draftCount : 0;
  const truncated = isOpen ? screen.summary.truncated : false;
  const canStart =
    isOpen &&
    expenseCount > 0 &&
    draftCount === 0 &&
    household.partner !== null;

  return (
    <main className="mx-auto w-full max-w-md space-y-6 p-6">
      <h1 className="text-xl font-bold">
        {isOpen ? "精算" : "確認待ちの精算"}
      </h1>

      <section className={`${cardClass} p-4`}>
        <p className="text-sm text-muted">
          {isOpen ? "未精算差額" : "確認待ちの精算"}
        </p>
        <p className="text-2xl font-bold tabular-nums">{formatYen(amount)}</p>
        <p className="mt-1 text-xs text-muted">
          {amount === 0
            ? expenseCount === 0
              ? "未精算の支出はありません"
              : "貸し借りはありません"
            : `${memberNameWithHonorific(fromMemberId)}が ${memberNameWithHonorific(
                toMemberId,
              )}に 支払います`}
        </p>
        {!isOpen && (
          <p className="mt-2 text-xs text-muted">
            {expenseCount}件の支出を対象に {memberName(screen.pending.startedBy)}
            が開始
          </p>
        )}
      </section>

      {isOpen && household.partner === null && (
        <p className="text-sm text-warn-strong">
          パートナーが参加してから精算できます
        </p>
      )}

      {isOpen && draftCount > 0 && (
        <p role="alert" className="text-sm text-warn-strong">
          未確定のレシートが{draftCount}件あります。確定または削除してから精算してください{" "}
          <Link href="/?filter=draft" className={linkClass}>
            未確定の支出を見る
          </Link>
        </p>
      )}

      {isOpen && truncated && (
        <p className="text-sm text-muted">
          未精算の支出が多いため、古いほうから{expenseCount}
          件を今回の対象にしています。残りは次回の精算に回ります
        </p>
      )}

      {!isOpen && screen.countMismatch && (
        <p role="alert" className="text-sm text-warn-strong">
          精算の対象が変わっているため完了できません。時間をおいて再度お試しください
        </p>
      )}

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">
          精算の対象({expenseCount}件)
        </h2>
        {screen.expenses.length === 0 ? (
          <p className="text-sm text-muted">精算する支出がありません</p>
        ) : (
          <ul className="space-y-2">
            {screen.expenses.map((expense) => (
              <li key={expense._id} className={`${cardClass} p-3`}>
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

      {isOpen && (
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
            className={inputClass}
          />
          <p className="text-right text-xs text-muted">
            {memo.length}/{MAX_MEMO_LENGTH}
          </p>
        </section>
      )}

      {!isOpen && screen.next.expenseCount > 0 && (
        <p className="text-sm text-muted">
          開始後に登録された {screen.next.expenseCount} 件は次回の精算に回ります
        </p>
      )}

      {error !== null && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}

      {isOpen ? (
        <button
          type="button"
          onClick={handleStart}
          disabled={!canStart || submitting}
          className={`${primaryButtonClass} w-full`}
        >
          {submitting ? "精算中…" : "精算する"}
        </button>
      ) : screen.pending.viewerRole === "starter" ? (
        <button
          type="button"
          onClick={handleRelease}
          disabled={submitting}
          className={`${secondaryButtonClass} w-full`}
        >
          {submitting ? "取り下げ中…" : "取り下げる"}
        </button>
      ) : (
        <div className="space-y-2">
          <button
            type="button"
            onClick={handleConfirm}
            disabled={submitting || screen.countMismatch}
            className={`${primaryButtonClass} w-full`}
          >
            {submitting ? "確認中…" : "確認して完了"}
          </button>
          <button
            type="button"
            onClick={handleRelease}
            disabled={submitting}
            className={`${secondaryButtonClass} w-full`}
          >
            {submitting ? "差し戻し中…" : "差し戻す"}
          </button>
        </div>
      )}

      <p className="text-xs text-muted">
        実際の送金はアプリの外(現金・送金アプリなど)で行ってください
      </p>
    </main>
  );
}
