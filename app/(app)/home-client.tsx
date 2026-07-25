"use client";

import { api } from "@/convex/_generated/api";
import { formatDateLabel, formatYen } from "@/lib/format";
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

const badgeClass =
  "rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap";

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
    return <main className="p-8 text-gray-500">読み込み中…</main>;
  }
  if (!isAuthenticated) {
    return null; // 未ログイン: proxyが/loginへ誘導する
  }
  if (member === undefined) {
    return <main className="p-8 text-gray-500">読み込み中…</main>;
  }
  if (member === null) {
    return null; // 世帯未所属: /setupへ誘導中
  }

  // 支払者の表示名。ID→名前の対応は household から引く
  const memberName = (memberId: string) => {
    if (household === undefined) {
      return "";
    }
    if (memberId === household.self._id) {
      return `${household.self.displayName}(あなた)`;
    }
    if (memberId === household.partner?._id) {
      return household.partner.displayName;
    }
    return "メンバー";
  };

  return (
    <main className="mx-auto w-full max-w-md space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-bold">warikapp</h1>
        <p className="text-sm text-gray-500">
          こんにちは、{member.displayName} さん
        </p>
      </header>

      {/* 未精算差額(Phase 7で本実装。ここでは枠だけ置く) */}
      <section className="rounded-lg border border-black/15 p-4 dark:border-white/25">
        <p className="text-sm text-gray-500">未精算差額</p>
        <p className="text-2xl font-bold">—</p>
        <p className="mt-1 text-xs text-gray-500">
          差額の計算と精算は次のステップで対応します
        </p>
      </section>

      <div className="grid grid-cols-2 gap-3">
        <Link
          href="/expenses/new/receipt"
          className="rounded-md border border-black/15 px-4 py-3 text-center text-sm font-medium dark:border-white/25"
        >
          + レシート
        </Link>
        <Link
          href="/expenses/new/manual"
          className="rounded-md bg-foreground px-4 py-3 text-center text-sm font-medium text-background"
        >
          + 手入力
        </Link>
      </div>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">支出</h2>
          <div className="flex gap-1" role="group" aria-label="表示する支出">
            {(["unsettled", "all"] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setFilter(value)}
                aria-pressed={filter === value}
                className={`rounded-full px-3 py-1 text-xs font-medium ${
                  filter === value
                    ? "bg-foreground text-background"
                    : "border border-black/15 dark:border-white/25"
                }`}
              >
                {FILTER_LABEL[value]}
              </button>
            ))}
          </div>
        </div>

        {expenses.status === "LoadingFirstPage" ? (
          <p className="text-sm text-gray-500">読み込み中…</p>
        ) : expenses.results.length === 0 ? (
          <p className="text-sm text-gray-500">
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
                  className="flex items-center justify-between gap-3 rounded-lg border border-black/15 p-3 dark:border-white/25"
                >
                  <span className="min-w-0 space-y-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="truncate font-medium">
                        {expense.title}
                      </span>
                      {expense.status === "draft" && (
                        <span
                          className={`${badgeClass} bg-amber-100 text-amber-900 dark:bg-amber-900 dark:text-amber-100`}
                        >
                          未確定
                        </span>
                      )}
                      {expense.settled && (
                        <span
                          className={`${badgeClass} bg-black/10 text-gray-600 dark:bg-white/15 dark:text-gray-300`}
                        >
                          精算済み
                        </span>
                      )}
                    </span>
                    <span className="block text-xs text-gray-500">
                      {formatDateLabel(expense.purchasedAt)} ・{" "}
                      {memberName(expense.paidBy)}が支払い
                      {expense.itemCount > 1 && ` ・ ${expense.itemCount}品目`}
                    </span>
                  </span>
                  <span className="whitespace-nowrap font-bold">
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
            className="w-full rounded-md border border-dashed border-black/25 px-4 py-3 text-sm font-medium dark:border-white/35"
          >
            もっと読み込む
          </button>
        )}
        {expenses.status === "LoadingMore" && (
          <p className="text-sm text-gray-500">読み込み中…</p>
        )}
      </section>

      <nav className="flex gap-4 text-sm text-blue-600">
        <Link href="/settlement" className="underline">
          精算
        </Link>
        <Link href="/settlements" className="underline">
          精算履歴
        </Link>
        <Link href="/settings" className="underline">
          設定
        </Link>
      </nav>
    </main>
  );
}
