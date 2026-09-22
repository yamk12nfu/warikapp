"use client";

import { api } from "@/convex/_generated/api";
import { todayInJst } from "@/lib/date";
import { formatYen } from "@/lib/format";
import {
  categoryRatio,
  formatYearMonthLabel,
  monthHref,
  parseBookMonth,
  requireYearMonth,
  type YearMonth,
} from "@/lib/month-book";
import { amountClass, cardClass, linkClass, memberColorClass } from "@/lib/ui";
import {
  useMonthBook,
  type MonthPoint,
  type MonthPointWindow,
  type MonthSlice,
} from "@/lib/use-month-book";
import { useConvexAuth, useQuery } from "convex/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function MonthBookClient({ month }: { month: YearMonth }) {
  const router = useRouter();
  const { isLoading, isAuthenticated } = useConvexAuth();
  const member = useQuery(
    api.couples.currentMember,
    isAuthenticated ? {} : "skip",
  );
  const todayMonth = requireYearMonth(todayInJst().slice(0, 7));
  const book = useMonthBook(month, todayMonth, member != null);

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

  return (
    <main className="mx-auto w-full max-w-md space-y-6 p-6">
      <div className="flex items-center justify-between gap-2">
        {parseBookMonth(book.prevMonth) === null ? (
          <span className="text-sm text-muted">前の月</span>
        ) : (
          <Link href={monthHref(book.prevMonth)} className={linkClass}>
            前の月
          </Link>
        )}
        <h1 className="text-xl font-bold">{formatYearMonthLabel(month)}</h1>
        {book.nextMonth === null ? (
          <span className="text-sm text-muted">次の月</span>
        ) : (
          <Link href={monthHref(book.nextMonth)} className={linkClass}>
            次の月
          </Link>
        )}
      </div>

      <Focus point={book.focus} />
      <Trend months={book.months} points={book.points} anchor={month} />
    </main>
  );
}

function Focus({ point }: { point: MonthPoint }) {
  if (point.kind === "loading") {
    return <p className="text-sm text-muted">読み込み中…</p>;
  }
  if (point.kind === "overflow") {
    return (
      <section className={`${cardClass} space-y-2 p-5`}>
        <h2 className="text-sm font-semibold">この月の合計</h2>
        <p className="text-sm">
          支出が多すぎてこの月は集計できません。上限は{point.limit}件です。
        </p>
      </section>
    );
  }
  return <ExactMonth slice={point.slice} />;
}

function ExactMonth({ slice }: { slice: MonthSlice }) {
  return (
    <section className={`${cardClass} space-y-4 p-5`}>
      <div>
        <h2 className="text-sm font-semibold">この月の合計</h2>
        <p className={`mt-1 text-3xl ${amountClass}`}>
          {formatYen(slice.totalAmount)}
        </p>
        {slice.unsettledAmount > 0 && (
          <p className="mt-1 text-sm text-muted">
            未精算 {formatYen(slice.unsettledAmount)}
          </p>
        )}
      </div>

      <ul className="space-y-3">
        {slice.members.map((member) => (
          <li key={member.memberId} className="space-y-1">
            <p className="flex items-center gap-1.5 text-sm font-bold">
              <span
                aria-hidden
                className={`size-2 rounded-full ${memberColorClass(member.isViewer)}`}
              />
              {member.isViewer ? "あなた" : member.displayName}
            </p>
            <p className="flex items-baseline justify-between text-sm">
              <span className="text-muted">支払</span>
              <span className={amountClass}>{formatYen(member.paidAmount)}</span>
            </p>
            <p className="flex items-baseline justify-between text-sm">
              <span className="text-muted">負担</span>
              <span className={amountClass}>{formatYen(member.shareAmount)}</span>
            </p>
          </li>
        ))}
      </ul>

      {slice.categories.length === 0 ? (
        <p className="text-sm text-muted">確定した支出はありません</p>
      ) : (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold">分類</h3>
          <ul className="space-y-3">
            {slice.categories.map((category) => {
              const width = Math.min(
                100,
                categoryRatio(category.amount, slice.totalAmount) * 100,
              );
              return (
                <li key={category.id} className="space-y-1">
                  <p className="flex items-baseline justify-between gap-3 text-sm">
                    <span>{category.label}</span>
                    <span className={amountClass}>{formatYen(category.amount)}</span>
                  </p>
                  <div
                    aria-hidden
                    className="h-2 overflow-hidden rounded-full bg-line"
                  >
                    <div
                      className="h-full rounded-full bg-me"
                      style={{ width: `${width}%` }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}

function Trend({
  months,
  points,
  anchor,
}: {
  months: readonly YearMonth[];
  points: MonthPointWindow;
  anchor: YearMonth;
}) {
  const max = maxShare(points);
  const partner = partnerLabel(points);
  return (
    <section className={`${cardClass} p-4`}>
      <h2 className="text-sm font-semibold">負担の推移</h2>
      {partner !== null && (
        <p className="mt-1 text-xs text-muted">あなたと{partner}</p>
      )}
      <ol className="mt-3 grid grid-cols-6 gap-1">
        {months.map((month, index) => {
          const point = points[index];
          if (point === undefined) {
            return null;
          }
          const label = `${Number(month.slice(5, 7))}月`;
          const body = (
            <>
              <span
                className={`block text-center text-[10px] ${
                  month === anchor ? "font-bold" : "text-muted"
                }`}
              >
                {month.slice(0, 4) !== anchor.slice(0, 4) ? month.slice(0, 4) : "\u00a0"}
              </span>
              <span
                className={`block text-center text-xs ${month === anchor ? "font-bold" : ""}`}
              >
                {label}
              </span>
              <SlotBars point={point} max={max} />
            </>
          );
          return (
            <li key={month}>
              {month === anchor ? (
                <div>{body}</div>
              ) : (
                <Link href={monthHref(month)} className="block">
                  {body}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function SlotBars({ point, max }: { point: MonthPoint; max: number }) {
  if (point.kind === "loading") {
    return <p className="mt-2 text-center text-xs text-muted">…</p>;
  }
  if (point.kind === "overflow") {
    return <p className="mt-2 text-center text-xs text-muted">—</p>;
  }
  const viewer = point.slice.members[0];
  const partner = point.slice.members[1];
  return (
    <div className="mt-2 space-y-1">
      <div className="flex h-16 items-end justify-center gap-0.5" aria-hidden>
        <div
          className="w-2 rounded-sm bg-me"
          style={{ height: barHeight(viewer.shareAmount, max) }}
        />
        {partner !== undefined && (
          <div
            className="w-2 rounded-sm bg-partner"
            style={{ height: barHeight(partner.shareAmount, max) }}
          />
        )}
      </div>
      <p className={`text-center text-[10px] leading-tight ${amountClass}`}>
        {formatYen(viewer.shareAmount)}
      </p>
      {partner !== undefined && (
        <p className={`text-center text-[10px] leading-tight text-muted ${amountClass}`}>
          {formatYen(partner.shareAmount)}
        </p>
      )}
    </div>
  );
}

function barHeight(amount: number, max: number): string {
  if (max <= 0 || amount <= 0) {
    return "0%";
  }
  return `${(amount / max) * 100}%`;
}

function maxShare(points: MonthPointWindow): number {
  let max = 0;
  for (const point of points) {
    if (point.kind !== "exact") {
      continue;
    }
    for (const member of point.slice.members) {
      if (member.shareAmount > max) {
        max = member.shareAmount;
      }
    }
  }
  return max;
}

function partnerLabel(points: MonthPointWindow): string | null {
  for (const point of points) {
    if (point.kind === "exact" && point.slice.members[1] !== undefined) {
      return point.slice.members[1].displayName;
    }
  }
  return null;
}
