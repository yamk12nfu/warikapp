"use client";

import { useConvexAuth, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import Link from "next/link";

const screens = [
  { href: "/login", label: "S-001 ログイン" },
  { href: "/setup", label: "S-002 世帯セットアップ" },
  { href: "/expenses/new/receipt", label: "S-004 レシート登録" },
  { href: "/expenses/sample-id", label: "S-005 支出詳細・編集" },
  { href: "/expenses/new/manual", label: "S-006 手入力登録" },
  { href: "/settlement", label: "S-007 精算確認・実行" },
  { href: "/settlements", label: "S-008 精算履歴" },
  { href: "/settings", label: "S-009 設定" },
];

export default function HomeClient() {
  const router = useRouter();
  // Convex側のJWT検証が完了するまでqueryを実行しない(実行すると認証確立前の
  // nullを「世帯未所属」と誤解し、所属済みユーザーを/setupへ誤誘導してしまう)
  const { isLoading, isAuthenticated } = useConvexAuth();
  const member = useQuery(
    api.couples.currentMember,
    isAuthenticated ? {} : "skip",
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

  return (
    <main className="p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">warikapp</h1>
        <p className="text-sm text-gray-500">
          こんにちは、{member.displayName} さん
        </p>
        <p className="text-sm text-gray-500">
          TODO: ホーム(S-003)— 未精算差額+支出一覧
        </p>
      </div>
      <nav>
        <h2 className="text-sm font-semibold text-gray-500 mb-2">
          画面一覧(開発用)
        </h2>
        <ul className="list-disc pl-5 space-y-1">
          {screens.map((s) => (
            <li key={s.href}>
              <Link href={s.href} className="text-blue-600 underline">
                {s.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </main>
  );
}
