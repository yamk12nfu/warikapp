"use client";

import { api } from "@/convex/_generated/api";
import type {
  SettlementDetail,
  SettlementExpenseDetail,
  SettlementItemDetail,
  SettlementParticipant,
} from "@/convex/settlements";
import { formatDateLabel, formatYen } from "@/lib/format";
import { linkClass, memberColorClass } from "@/lib/ui";
import { useConvexAuth, useQuery } from "convex/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

function formatSettledAt(settledAt: number): string {
  return new Date(settledAt).toLocaleString("ja-JP", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function memberName(
  memberId: string,
  participants: SettlementParticipant[],
): string {
  const participant = participants.find((row) => row.memberId === memberId);
  if (participant === undefined) {
    return "メンバー";
  }
  return participant.isViewer ? "あなた" : participant.displayName;
}

export default function SettlementDetailClient({
  settlementId,
}: {
  settlementId: string;
}) {
  const router = useRouter();
  const { isLoading, isAuthenticated } = useConvexAuth();
  const member = useQuery(
    api.couples.currentMember,
    isAuthenticated ? {} : "skip",
  );
  const result = useQuery(
    api.settlements.detail,
    member ? { settlementId } : "skip",
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
  if (member === undefined) {
    return <main className="p-8 text-muted">読み込み中…</main>;
  }
  if (member === null) {
    return null;
  }
  if (result === undefined) {
    return <main className="p-8 text-muted">読み込み中…</main>;
  }
  if (result.kind === "notFound") {
    return (
      <main className="mx-auto w-full max-w-md space-y-4 p-6">
        <p className="text-sm">精算が見つかりません</p>
        <Link href="/settlements" className={`block ${linkClass}`}>
          精算履歴へ戻る
        </Link>
      </main>
    );
  }

  return <SettlementDetailView detail={result.detail} />;
}

function SettlementDetailView({ detail }: { detail: SettlementDetail }) {
  const { participants, settlement, expenses } = detail;
  const direction =
    settlement.amount === 0
      ? "貸し借りなしで精算"
      : `${memberName(settlement.fromMemberId, participants)} → ${memberName(
          settlement.toMemberId,
          participants,
        )}`;

  return (
    <main className="mx-auto w-full max-w-md space-y-6 p-6">
      <div>
        <Link href="/settlements" className={linkClass}>
          ← 精算履歴
        </Link>
        <h1 className="mt-2 text-xl font-bold">精算の内訳</h1>
        <p className="mt-2 text-sm text-muted">
          {formatSettledAt(settlement.settledAt)}
        </p>
      </div>

      <section className="space-y-2 rounded-2xl bg-surface p-4 shadow-card">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-sm text-muted">精算額</span>
          <span className="text-lg font-bold tabular-nums">
            {formatYen(settlement.amount)}
          </span>
        </div>
        <p className="text-sm">{direction}</p>
        <p className="text-xs text-muted">
          対象 {settlement.expenseCount}件
          {settlement.memo !== undefined && ` ・ ${settlement.memo}`}
        </p>
        {settlement.countMismatch === true && (
          <p className="text-xs text-muted">
            対象件数と表示中の支出数が一致していません
          </p>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">支出({expenses.length}件)</h2>
        {expenses.length === 0 ? (
          <p className="text-sm text-muted">表示できる支出がありません</p>
        ) : (
          <ul className="space-y-2">
            {expenses.map((expense) => (
              <ExpenseBreakdownCard
                key={expense.expenseId}
                expense={expense}
                participants={participants}
              />
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

function ExpenseBreakdownCard({
  expense,
  participants,
}: {
  expense: SettlementExpenseDetail;
  participants: SettlementParticipant[];
}) {
  return (
    <li className="space-y-2 rounded-2xl bg-surface p-3 shadow-card">
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 truncate font-bold">{expense.title}</span>
        <span className="whitespace-nowrap font-bold tabular-nums">
          {formatYen(expense.totalAmount)}
        </span>
      </div>
      <p className="text-xs text-muted">
        {formatDateLabel(expense.purchasedAt)} ・{" "}
        {memberName(expense.paidByMemberId, participants)}が支払い ・ 立て替え{" "}
        {formatYen(expense.advanceAmount)}
      </p>
      <ul className="space-y-2">
        {expense.items.map((item, index) => (
          <ItemBreakdownRow
            key={`${item.name}-${index}`}
            item={item}
            participants={participants}
          />
        ))}
      </ul>
    </li>
  );
}

function ItemBreakdownRow({
  item,
  participants,
}: {
  item: SettlementItemDetail;
  participants: SettlementParticipant[];
}) {
  const viewerId = participants.find((row) => row.isViewer)?.memberId;
  return (
    <li className="rounded-xl bg-background px-3 py-2">
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 truncate text-sm font-bold">{item.name}</span>
        <span className="whitespace-nowrap text-sm font-bold tabular-nums">
          {formatYen(item.lineTotal)}
        </span>
      </div>
      <p className="text-xs text-muted">
        {formatYen(item.unitPrice)} × {item.quantity}
      </p>
      <ul className="mt-1 space-y-0.5 text-xs text-muted">
        {item.shares.map((share) => (
          <li key={share.memberId} className="flex items-center gap-1.5">
            <span
              aria-hidden
              className={`size-2 rounded-full ${memberColorClass(
                share.memberId === viewerId,
              )}`}
            />
            {memberName(share.memberId, participants)} {share.ratioPercent}% ・{" "}
            {formatYen(share.amount)}
          </li>
        ))}
      </ul>
      {item.advance.kind === "advanced" && (
        <p className="mt-1 text-xs text-muted">
          {memberName(item.advance.advancedByMemberId, participants)}が
          {memberName(item.advance.forMemberId, participants)}のために
          {formatYen(item.advance.amount)}立て替え
        </p>
      )}
    </li>
  );
}
