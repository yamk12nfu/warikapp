"use client";

import DangerActionConfirm from "@/components/DangerActionConfirm";
import FixedCostEditor, {
  type FixedCostFormValue,
} from "@/components/FixedCostEditor";
import { shareRatioLabel } from "@/components/ShareRatioPicker";
import { useToast } from "@/components/Toast";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { categoryLabel, toStoredCategory } from "@/lib/category";
import { toUserMessage } from "@/lib/convex-error";
import { formatYen } from "@/lib/format";
import {
  badgeClass,
  linkClass,
  primaryButtonClass,
  rowCardClass,
} from "@/lib/ui";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export function StoppedFixedCostSummary({
  amount,
  payerName,
  shareLabel,
  categoryName,
}: {
  amount: number;
  payerName: string;
  shareLabel: string;
  categoryName?: string;
}) {
  return (
    <section className={`${rowCardClass} space-y-3`}>
      <h2 className="text-sm font-semibold">固定費の内容</h2>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
        <dt className="text-muted">金額</dt>
        <dd className="text-right font-bold tabular-nums">{formatYen(amount)}</dd>
        <dt className="text-muted">支払者</dt>
        <dd className="text-right">{payerName}</dd>
        <dt className="text-muted">負担区分</dt>
        <dd className="text-right">{shareLabel}</dd>
        {categoryName !== undefined && (
          <>
            <dt className="text-muted">分類</dt>
            <dd className="text-right">{categoryName}</dd>
          </>
        )}
      </dl>
    </section>
  );
}

export default function FixedCostDetailClient({
  fixedCostId,
}: {
  fixedCostId: string;
}) {
  const router = useRouter();
  const { isLoading, isAuthenticated } = useConvexAuth();
  const member = useQuery(
    api.couples.currentMember,
    isAuthenticated ? {} : "skip",
  );
  const household = useQuery(api.couples.household, member ? {} : "skip");
  const fixedCost = useQuery(
    api.fixedCosts.get,
    member ? { fixedCostId } : "skip",
  );
  const saveFixedCost = useMutation(api.fixedCosts.save);
  const stopFixedCost = useMutation(api.fixedCosts.stop);
  const resumeFixedCost = useMutation(api.fixedCosts.resume);
  const { show: showToast } = useToast();
  const [stopError, setStopError] = useState<string | null>(null);
  const [resumeError, setResumeError] = useState<string | null>(null);
  const [resumePending, setResumePending] = useState(false);

  useEffect(() => {
    if (isAuthenticated && member === null) {
      router.replace("/setup");
    }
  }, [isAuthenticated, member, router]);

  async function handleSave(value: FixedCostFormValue) {
    await saveFixedCost({
      fixedCostId,
      name: value.name,
      amount: value.amount,
      paidBy: value.paidBy as Id<"members">,
      shares: value.shares.map((share) => ({
        ...share,
        memberId: share.memberId as Id<"members">,
      })),
      category: toStoredCategory(value.category) ?? null,
    });
  }

  async function handleStop() {
    setStopError(null);
    try {
      await stopFixedCost({ fixedCostId });
      router.replace("/fixed-costs");
    } catch (caught) {
      setStopError(toUserMessage(caught));
    }
  }

  async function handleResume() {
    setResumeError(null);
    setResumePending(true);
    try {
      const result = await resumeFixedCost({ fixedCostId });
      showToast(
        result === "posted"
          ? "再開して今月分を計上しました"
          : result === "exists"
            ? "再開しました(今月分は計上済み)"
            : "再開しました",
      );
    } catch (caught) {
      setResumeError(toUserMessage(caught));
    } finally {
      setResumePending(false);
    }
  }

  if (isLoading) {
    return <main className="p-8 text-muted">読み込み中…</main>;
  }
  if (!isAuthenticated) {
    return null;
  }
  if (
    member === undefined ||
    (member !== null && (household === undefined || fixedCost === undefined))
  ) {
    return <main className="p-8 text-muted">読み込み中…</main>;
  }
  if (member === null || household === undefined || fixedCost === undefined) {
    return null;
  }
  if (fixedCost === null) {
    return (
      <main className="mx-auto w-full max-w-md space-y-4 p-6">
        <p className="text-sm">固定費が見つかりません</p>
        <Link href="/fixed-costs" className={linkClass}>
          固定費一覧へ戻る
        </Link>
      </main>
    );
  }

  const stopped = fixedCost.stoppedAt !== undefined;
  const stoppedLabel =
    fixedCost.stoppedReason === "memberLeft"
      ? "パートナーの退出により停止"
      : "停止";

  return (
    <main className="mx-auto w-full max-w-md space-y-6 p-6">
      <header>
        <Link href="/fixed-costs" className={linkClass}>
          ← 固定費一覧
        </Link>
        <h1 className="mt-2 text-xl font-bold">{fixedCost.name}</h1>
        {stopped && (
          <span className={`${badgeClass} mt-2 inline-block bg-line text-muted`}>
            {stoppedLabel}
          </span>
        )}
      </header>

      {stopped ? (
        <>
          <StoppedFixedCostSummary
            amount={fixedCost.amount}
            payerName={
              fixedCost.paidBy === household.self._id
                ? household.self.displayName
                : household.partner?._id === fixedCost.paidBy
                  ? household.partner.displayName
                  : "メンバー"
            }
            shareLabel={shareRatioLabel(
              fixedCost.shares,
              household.self._id,
              household.partner?._id ?? null,
            )}
            categoryName={
              fixedCost.category === undefined
                ? undefined
                : categoryLabel(fixedCost.category)
            }
          />
          <section className="space-y-3">
            {resumeError !== null && (
              <p role="alert" className="text-sm text-danger">
                {resumeError}
              </p>
            )}
            <button
              type="button"
              onClick={handleResume}
              disabled={resumePending}
              className={`${primaryButtonClass} w-full`}
            >
              {resumePending ? "再開中…" : "再開する"}
            </button>
          </section>
        </>
      ) : (
        <>
          <FixedCostEditor
            self={household.self}
            partner={household.partner}
            initialValue={{
              name: fixedCost.name,
              amount: fixedCost.amount,
              paidBy: fixedCost.paidBy,
              shares: fixedCost.shares,
              category: fixedCost.category,
            }}
            mode="edit"
            onSubmit={handleSave}
          />
          <section className="space-y-3 rounded-2xl border border-edge bg-surface p-4">
            <h2 className="text-sm font-semibold">固定費の停止</h2>
            <DangerActionConfirm
              label="この固定費を停止"
              description="これからの月の自動計上を止めます。すでに計上した支出はそのまま残ります。"
              confirmLabel="停止する"
              pendingLabel="停止中…"
              blockerMessage={null}
              error={stopError}
              onConfirm={handleStop}
            />
          </section>
        </>
      )}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-muted">計上履歴</h2>
        {fixedCost.history.length === 0 ? (
          <p className="text-sm text-muted">計上履歴はありません。</p>
        ) : (
          <ul className="space-y-2">
            {fixedCost.history.map((row) => (
              <li key={row.expenseId}>
                <div className={`${rowCardClass} flex items-center justify-between gap-3`}>
                  <span className="min-w-0 space-y-1">
                    <span className="block font-bold">
                      {row.month.slice(0, 4)}年{Number(row.month.slice(5, 7))}月
                    </span>
                    {row.deleted ? (
                      <span className="block text-xs text-muted">
                        削除済み(再計上しません)
                      </span>
                    ) : (
                      <Link
                        href={`/expenses/${row.expenseId}`}
                        className={linkClass}
                      >
                        支出を見る
                      </Link>
                    )}
                  </span>
                  <span className="shrink-0 space-y-1 text-right">
                    <span className="block whitespace-nowrap font-bold tabular-nums">
                      {formatYen(row.totalAmount)}
                    </span>
                    {row.settled && (
                      <span className={`${badgeClass} bg-line text-muted`}>
                        精算済み
                      </span>
                    )}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
