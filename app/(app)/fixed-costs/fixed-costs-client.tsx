"use client";

import { api } from "@/convex/_generated/api";
import { formatYen } from "@/lib/format";
import {
  badgeClass,
  linkClass,
  primaryButtonClass,
  rowCardClass,
} from "@/lib/ui";
import { useConvexAuth, useQuery } from "convex/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

const THIS_MONTH_LABEL = {
  posted: "計上済み",
  notPosted: "未計上",
  deleted: "削除済み",
  notStarted: "開始前",
} as const;

const THIS_MONTH_BADGE = {
  posted: "bg-ok-soft text-ok-strong",
  notPosted: "bg-warn-soft text-warn-strong",
  deleted: "bg-line text-muted",
  notStarted: "bg-line text-muted",
} as const;

export default function FixedCostsClient({ month }: { month: string }) {
  const router = useRouter();
  const { isLoading, isAuthenticated } = useConvexAuth();
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
