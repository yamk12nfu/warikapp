"use client";

import { api } from "@/convex/_generated/api";
import { useToast } from "@/components/Toast";
import { toUserMessage } from "@/lib/convex-error";
import { formatYen } from "@/lib/format";
import {
  badgeClass,
  linkClass,
  primaryButtonClass,
  rowCardClass,
  secondaryButtonClass,
} from "@/lib/ui";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

const THIS_MONTH_LABEL = {
  posted: "計上済み",
  notPosted: "未計上",
  deleted: "削除済み",
  notStarted: "開始前",
} as const;

const THIS_MONTH_BADGE = {
  posted: "bg-ok-soft text-ok",
  notPosted: "bg-warn-soft text-warn-strong",
  deleted: "bg-line text-muted",
  notStarted: "bg-line text-muted",
} as const;

export default function FixedCostsClient({ month }: { month: string }) {
  const router = useRouter();
  const { isLoading, isAuthenticated } = useConvexAuth();
  const postThisMonth = useMutation(api.fixedCosts.postThisMonth);
  const { show: showToast } = useToast();
  const [postingId, setPostingId] = useState<string | null>(null);
  const [postError, setPostError] = useState<{
    fixedCostId: string;
    message: string;
  } | null>(null);
  const member = useQuery(
    api.couples.currentMember,
    isAuthenticated ? {} : "skip",
  );
  const household = useQuery(api.couples.household, member ? {} : "skip");
  const fixedCosts = useQuery(
    api.fixedCosts.list,
    member ? { month } : "skip",
  );

  useEffect(() => {
    if (isAuthenticated && member === null) {
      router.replace("/setup");
    }
  }, [isAuthenticated, member, router]);

  async function handlePostThisMonth(fixedCostId: string) {
    setPostingId(fixedCostId);
    setPostError(null);
    try {
      const result = await postThisMonth({ fixedCostId });
      if (result === "posted") {
        showToast("今月分を計上しました");
      }
    } catch (caught) {
      setPostError({ fixedCostId, message: toUserMessage(caught) });
    } finally {
      setPostingId(null);
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
    (member !== null && (household === undefined || fixedCosts === undefined))
  ) {
    return <main className="p-8 text-muted">読み込み中…</main>;
  }
  if (member === null || household === undefined || fixedCosts === undefined) {
    return null;
  }

  const payerName = (paidBy: string) =>
    paidBy === household.self._id
      ? "あなた"
      : household.partner?._id === paidBy
        ? household.partner.displayName
        : "メンバー";

  return (
    <main className="mx-auto w-full max-w-md space-y-6 p-6">
      <header className="space-y-3">
        <h1 className="text-xl font-bold">固定費</h1>
        <p className="text-sm text-muted">{month}分の登録内容</p>
        <Link href="/fixed-costs/new" className={`${primaryButtonClass} block`}>
          ＋ 固定費を追加
        </Link>
      </header>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-muted">登録中</h2>
        {fixedCosts.active.length === 0 ? (
          <p className="text-sm text-muted">固定費はまだ登録されていません。</p>
        ) : (
          <ul className="space-y-2">
            {fixedCosts.active.map((fixedCost) => (
              <li key={fixedCost._id}>
                <div className="space-y-2">
                  <Link
                    href={`/fixed-costs/${fixedCost._id}`}
                    className={`flex items-center justify-between gap-3 ${rowCardClass}`}
                  >
                    <span className="min-w-0 space-y-1">
                      <span className="block truncate font-bold">
                        {fixedCost.name}
                      </span>
                      <span className="block text-xs text-muted">
                        {payerName(fixedCost.paidBy)}が支払い
                      </span>
                    </span>
                    <span className="shrink-0 space-y-1 text-right">
                      <span className="block whitespace-nowrap font-bold tabular-nums">
                        {formatYen(fixedCost.amount)}
                      </span>
                      <span
                        className={`${badgeClass} ${THIS_MONTH_BADGE[fixedCost.thisMonth]}`}
                      >
                        {THIS_MONTH_LABEL[fixedCost.thisMonth]}
                      </span>
                    </span>
                  </Link>
                  {fixedCost.thisMonth === "notPosted" && (
                    <div className="space-y-2 px-1">
                      <div className="flex justify-end">
                        <button
                          type="button"
                          onClick={() => handlePostThisMonth(fixedCost._id)}
                          disabled={postingId !== null}
                          className={secondaryButtonClass}
                        >
                          {postingId === fixedCost._id
                            ? "計上中…"
                            : "今月分を計上する"}
                        </button>
                      </div>
                      {postError?.fixedCostId === fixedCost._id && (
                        <p role="alert" className="text-sm text-danger">
                          {postError.message}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-muted">停止済み</h2>
        {fixedCosts.stopped.length === 0 ? (
          <p className="text-sm text-muted">停止済みの固定費はありません。</p>
        ) : (
          <ul className="space-y-2">
            {fixedCosts.stopped.map((fixedCost) => (
              <li key={fixedCost._id}>
                <Link
                  href={`/fixed-costs/${fixedCost._id}`}
                  className={`flex items-center justify-between gap-3 ${rowCardClass}`}
                >
                  <span className="min-w-0 space-y-1">
                    <span className="block truncate font-bold">
                      {fixedCost.name}
                    </span>
                    <span className="block text-xs text-muted">
                      {fixedCost.stoppedReason === "memberLeft"
                        ? "パートナーの退出により停止"
                        : "停止"}
                    </span>
                  </span>
                  <span className="whitespace-nowrap font-bold tabular-nums">
                    {formatYen(fixedCost.amount)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Link href="/" className={linkClass}>
        ホームへ戻る
      </Link>
    </main>
  );
}
