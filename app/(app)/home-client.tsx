"use client";

import { api } from "@/convex/_generated/api";
import { formatDateLabel, formatYen } from "@/lib/format";
import {
  amountClass,
  badgeClass,
  cardClass,
  linkClass,
  payerEdgeClass,
  primaryButtonClass,
  rowCardClass,
  secondaryButtonClass,
} from "@/lib/ui";
import { useConvexAuth, usePaginatedQuery, useQuery } from "convex/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

// ホーム(S-003 / F-006)。未精算差額の枠・支出一覧・登録ボタンを置く。
// 一覧は usePaginatedQuery で20件ずつ読む。queryは自動でリアルタイム更新されるため、
// パートナーが登録した支出は画面を触らなくてもここに現れる。

const PAGE_SIZE = 20;

type Filter = "unsettled" | "all";

const FILTER_LABEL: Record<Filter, string> = {
  unsettled: "未精算のみ",
  all: "すべて",
};

export default function HomeClient() {
  const router = useRouter();
  // Convex側のJWT検証が完了するまでqueryを実行しない(実行すると認証確立前の
  // nullを「世帯未所属」と誤解し、所属済みユーザーを/setupへ誤誘導してしまう)
  const { isLoading, isAuthenticated } = useConvexAuth();
  const member = useQuery(
    api.couples.currentMember,
    isAuthenticated ? {} : "skip",
  );
  // household は requireMember で throw するため、所属済みが確定してから呼ぶ
  const household = useQuery(api.couples.household, member ? {} : "skip");
  const balance = useQuery(
    api.settlements.currentBalance,
    member ? {} : "skip",
  );
  const [filter, setFilter] = useState<Filter>("unsettled");
  const expenses = usePaginatedQuery(
    api.expenses.list,
    member ? { filter } : "skip",
    { initialNumItems: PAGE_SIZE },
  );

  useEffect(() => {
    // 認証確立後にnull = 本当に世帯未所属
    if (isAuthenticated && member === null) {
      router.replace("/setup");
    }
  }, [isAuthenticated, member, router]);

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

  // 差額の説明文。「あなたが ○○さんに 支払います」の形にする(要件 F-007)。
  // 呼び出し側で balance / household が揃ってから使う
  const balanceLabel = () => {
    if (balance === undefined || household === undefined) {
      return "";
    }
    if (balance.amount === 0) {
      return balance.expenseCount === 0
        ? "未精算の支出はありません"
        : "貸し借りはありません";
    }
    const name = (memberId: string | null) =>
      memberId === household.self._id
        ? "あなた"
        : memberId === household.partner?._id
          ? `${household.partner.displayName}さん`
          : "メンバー";
    return `${name(balance.fromMemberId)}が ${name(balance.toMemberId)}に 支払います`;
  };

  // 行の補足情報(日付・支払者・品目数)。支払者名は household から引くため、
  // 読み込みが終わるまでは支払者だけ省く(「が支払い」だけが出るのを防ぐ)
  const rowMeta = (expense: { purchasedAt: string; paidBy: string; itemCount: number }) => {
    const parts = [formatDateLabel(expense.purchasedAt)];
    if (household !== undefined) {
      const name =
        expense.paidBy === household.self._id
          ? `${household.self.displayName}(あなた)`
          : expense.paidBy === household.partner?._id
            ? household.partner.displayName
            : "メンバー";
      parts.push(`${name}が支払い`);
    }
    if (expense.itemCount > 1) {
      parts.push(`${expense.itemCount}品目`);
    }
    return parts.join(" ・ ");
  };

  // 支払者が自分かどうか。household 読み込み前は null(行の左縁を無色にする)
  const paidBySelf = (paidBy: string): boolean | null =>
    household === undefined ? null : paidBy === household.self._id;

  // 天秤バー。未精算(確定済み)の支払い合計をメンバー色で分け、
  // 多く払っている側へわずかに傾ける(ふたりの貸し借りをひと目で伝える要素)
  const beam = () => {
    if (balance === undefined || household === undefined) {
      return null;
    }
    // ?? 0 はデプロイ順の防御。フロントが先に新しくなり、Convex側が
    // まだ旧関数(このフィールドを返さない)の間でも落ちないようにする
    const paidSelf = balance.paidBySelf ?? 0;
    const paidPartner = balance.paidByPartner ?? 0;
    const total = paidSelf + paidPartner;
    if (total === 0 || household.partner === null) {
      return null;
    }
    const selfPct = Math.round((paidSelf / total) * 100);
    const tilt = paidSelf > paidPartner ? -1.5 : paidSelf < paidPartner ? 1.5 : 0;
    return (
      <div className="mt-3">
        <div
          aria-hidden
          className="flex h-3 overflow-hidden rounded-full"
          style={{ transform: `rotate(${tilt}deg)` }}
        >
          <div className="bg-me" style={{ width: `${selfPct}%` }} />
          <div className="bg-partner" style={{ width: `${100 - selfPct}%` }} />
        </div>
        <div className="mt-2 flex justify-between text-xs text-muted">
          <span>
            <span
              aria-hidden
              className="mr-1 inline-block size-2 rounded-full bg-me align-[1px]"
            />
            あなた {formatYen(paidSelf)}
          </span>
          <span>
            <span
              aria-hidden
              className="mr-1 inline-block size-2 rounded-full bg-partner align-[1px]"
            />
            {household.partner.displayName}さん {formatYen(paidPartner)}
          </span>
        </div>
      </div>
    );
  };

  return (
    <main className="mx-auto w-full max-w-md space-y-6 p-6">
      <header>
        <h1 className="text-xl font-bold">
          warik<span className="text-me">app</span>
        </h1>
        <p className="text-sm text-muted">
          こんにちは、{member.displayName} さん
        </p>
      </header>

      {/* 未精算差額(F-007)。常時表示し、タップで精算画面へ */}
      <Link href="/settlement" className={`block ${cardClass} p-5`}>
        <p className="text-xs font-bold text-muted">未精算差額</p>
        {balance === undefined || household === undefined ? (
          // 差額と支払う側の名前が揃うまでは金額を出さない(名前だけ先に出ると
          // 「あなたが さんに」のような欠けた文になる)
          <p className={`text-3xl ${amountClass}`}>—</p>
        ) : (
          <>
            <p className={`text-3xl ${amountClass}`}>
              {formatYen(balance.amount)}
            </p>
            <p className="mt-1 text-xs text-muted">{balanceLabel()}</p>
            {beam()}
            {/* 1回の精算で扱える件数を超えている = ここの金額は一部のぶんだけ */}
            {balance.truncated && (
              <p className="mt-2 text-xs text-warn-strong">
                未精算の支出が多いため、古い{balance.expenseCount}
                件ぶんの差額を表示しています
              </p>
            )}
          </>
        )}
      </Link>

      <div className="grid grid-cols-2 gap-3">
        <Link href="/expenses/new/receipt" className={primaryButtonClass}>
          ＋ レシート
        </Link>
        <Link href="/expenses/new/manual" className={secondaryButtonClass}>
          ＋ 手入力
        </Link>
      </div>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold">支出</h2>
          <div
            className="flex rounded-full bg-line p-0.5"
            role="group"
            aria-label="表示する支出"
          >
            {(["unsettled", "all"] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setFilter(value)}
                aria-pressed={filter === value}
                className={`rounded-full px-3 py-1 text-xs font-bold ${
                  filter === value
                    ? "bg-surface shadow-card"
                    : "text-muted"
                }`}
              >
                {FILTER_LABEL[value]}
              </button>
            ))}
          </div>
        </div>

        {expenses.status === "LoadingFirstPage" ? (
          <p className="text-sm text-muted">読み込み中…</p>
        ) : expenses.results.length === 0 ? (
          <p className="text-sm text-muted">
            {filter === "unsettled"
              ? "未精算の支出はまだありません"
              : "支出はまだありません"}
          </p>
        ) : (
          <ul className="space-y-2">
            {expenses.results.map((expense) => (
              <li key={expense._id}>
                <Link
                  href={`/expenses/${expense._id}`}
                  className={`flex items-center justify-between gap-3 ${rowCardClass} ${payerEdgeClass(
                    paidBySelf(expense.paidBy),
                  )}`}
                >
                  <span className="min-w-0 space-y-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="truncate font-bold">
                        {expense.title}
                      </span>
                      {expense.status === "draft" && (
                        <span
                          className={`${badgeClass} bg-warn-soft text-warn-strong`}
                        >
                          未確定
                        </span>
                      )}
                      {expense.settled && (
                        <span className={`${badgeClass} bg-line text-muted`}>
                          精算済み
                        </span>
                      )}
                    </span>
                    <span className="block text-xs text-muted">
                      {rowMeta(expense)}
                    </span>
                  </span>
                  <span className={`whitespace-nowrap ${amountClass}`}>
                    {formatYen(expense.totalAmount)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}

        {expenses.status === "CanLoadMore" && (
          <button
            type="button"
            onClick={() => expenses.loadMore(PAGE_SIZE)}
            className="w-full rounded-full border border-dashed border-line px-4 py-3 text-sm font-medium text-muted"
          >
            もっと読み込む
          </button>
        )}
        {expenses.status === "LoadingMore" && (
          <p className="text-sm text-muted">読み込み中…</p>
        )}
      </section>

      {/* 精算への導線は上の差額カードが担うので、ここには履歴と設定だけ置く */}
      <nav className="flex gap-4">
        <Link href="/settlements" className={linkClass}>
          精算履歴
        </Link>
        <Link href="/settings" className={linkClass}>
          設定
        </Link>
      </nav>
    </main>
  );
}
