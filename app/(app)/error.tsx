"use client";

import { linkClass, primaryButtonClass } from "@/lib/ui";
import { ConvexError } from "convex/values";
import Link from "next/link";
import { useEffect } from "react";

export default function AppError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  // ConvexError の文字列 data は画面に出す前提で書いた文言なので、そのまま見せる
  const message =
    error instanceof ConvexError && typeof error.data === "string"
      ? error.data
      : "時間をおいて、もう一度お試しください。";

  return (
    <main className="mx-auto w-full max-w-md space-y-6 p-6">
      <header className="space-y-2">
        <h1 className="text-xl font-bold">うまく表示できませんでした</h1>
        <p className="text-sm text-muted">{message}</p>
      </header>
      <button
        type="button"
        onClick={retry}
        className={`${primaryButtonClass} block w-full`}
      >
        もう一度読み込む
      </button>
      <Link href="/" className={linkClass}>
        ホームへ戻る
      </Link>
    </main>
  );
}
