"use client";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { toUserMessage } from "@/lib/convex-error";
import { formatYen } from "@/lib/format";
import {
  useConvexAuth,
  useMutation,
  usePaginatedQuery,
  useQuery,
} from "convex/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

// 精算履歴(S-008 / F-007)。日時・方向・金額・メモ・対象支出数を新しい順に並べる。
// 取り消せるのは直近1件だけ(サーバー側の settlements.cancel でも検証する)。

const PAGE_SIZE = 20;

// 精算日時は _creationTime(エポックms)。購入日と違い時刻まで出す
function formatSettledAt(settledAt: number): string {
  return new Date(settledAt).toLocaleString("ja-JP", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function SettlementsClient() {
  const router = useRouter();
  // Convex側のJWT検証が完了するまでqueryを実行しない(Phase 3と同じ理由)
  const { isLoading, isAuthenticated } = useConvexAuth();
  const member = useQuery(
    api.couples.currentMember,
    isAuthenticated ? {} : "skip",
  );
  // list / household は requireMember で throw するため、所属確定後に呼ぶ
  const household = useQuery(api.couples.household, member ? {} : "skip");
  const settlements = usePaginatedQuery(
    api.settlements.list,
    member ? {} : "skip",
    { initialNumItems: PAGE_SIZE },
  );
  const cancel = useMutation(api.settlements.cancel);
  const [error, setError] = useState<string | null>(null);
  const [cancelingId, setCancelingId] = useState<Id<"settlements"> | null>(
    null,
  );

  useEffect(() => {
    // 認証確立後にnull = 本当に世帯未所属
    if (isAuthenticated && member === null) {
      router.replace("/setup");
    }
  }, [isAuthenticated, member, router]);

  async function handleCancel(settlementId: Id<"settlements">) {
    if (
      !window.confirm(
        "この精算を取り消します。対象の支出は未精算に戻ります。よろしいですか?",
      )
    ) {
      return;
    }
    setError(null);
    setCancelingId(settlementId);
    try {
      await cancel({ settlementId });
    } catch (caught) {
      setError(toUserMessage(caught));
    } finally {
      setCancelingId(null);
    }
  }

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

  const memberName = (memberId: string) => {
    if (memberId === household?.self._id) {
      return "あなた";
    }
    if (memberId === household?.partner?._id) {
      return household.partner.displayName;
    }
    return "メンバー";
  };

  return (
    <main className="mx-auto w-full max-w-md space-y-6 p-6">
      <div>
        <Link href="/" className="text-sm text-blue-600 underline">
          ← ホーム
        </Link>
        <h1 className="mt-2 text-xl font-bold">精算履歴</h1>
      </div>

      {error !== null && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}

      {settlements.status === "LoadingFirstPage" ? (
        <p className="text-sm text-gray-500">読み込み中…</p>
      ) : settlements.results.length === 0 ? (
        <p className="text-sm text-gray-500">精算の記録はまだありません</p>
      ) : (
        <ul className="space-y-2">
          {settlements.results.map((settlement, index) => (
            <li
              key={settlement._id}
              className="space-y-2 rounded-lg border border-black/15 p-3 dark:border-white/25"
            >
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-xs text-gray-500">
                  {formatSettledAt(settlement.settledAt)}
                </span>
                <span className="whitespace-nowrap font-bold">
                  {formatYen(settlement.amount)}
                </span>
              </div>
              <p className="text-sm">
                {settlement.amount === 0
                  ? "貸し借りなしで精算"
                  : `${memberName(settlement.fromMemberId)} → ${memberName(
                      settlement.toMemberId,
                    )}`}
              </p>
              <p className="text-xs text-gray-500">
                対象 {settlement.expenseCount}件
                {settlement.memo !== undefined && ` ・ ${settlement.memo}`}
              </p>
              {/* 取り消せるのは直近1件のみ(要件 F-007) */}
              {index === 0 && (
                <button
                  type="button"
                  onClick={() => handleCancel(settlement._id)}
                  disabled={cancelingId !== null}
                  className="w-full rounded-md border border-black/15 px-4 py-2 text-sm font-medium text-red-600 disabled:opacity-50 dark:border-white/25"
                >
                  {cancelingId === settlement._id
                    ? "取り消し中…"
                    : "この精算を取り消す"}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {settlements.status === "CanLoadMore" && (
        <button
          type="button"
          onClick={() => settlements.loadMore(PAGE_SIZE)}
          className="w-full rounded-md border border-dashed border-black/25 px-4 py-3 text-sm font-medium dark:border-white/35"
        >
          もっと読み込む
        </button>
      )}
      {settlements.status === "LoadingMore" && (
        <p className="text-sm text-gray-500">読み込み中…</p>
      )}
    </main>
  );
}
