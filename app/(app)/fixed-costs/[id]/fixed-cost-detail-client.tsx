"use client";

import DangerActionConfirm from "@/components/DangerActionConfirm";
import FixedCostEditor, {
  type FixedCostFormValue,
} from "@/components/FixedCostEditor";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { toStoredCategory } from "@/lib/category";
import { toUserMessage } from "@/lib/convex-error";
import { formatYen } from "@/lib/format";
import { badgeClass, linkClass, rowCardClass } from "@/lib/ui";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

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
  const [stopError, setStopError] = useState<string | null>(null);

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
        <section className={`${rowCardClass} space-y-2`}>
          <h2 className="text-sm font-semibold">停止済み</h2>
          <p className="text-sm text-muted">{stoppedLabel}</p>
        </section>
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
