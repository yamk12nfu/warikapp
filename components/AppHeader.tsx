"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

// 全画面共通の上部固定ヘッダー(案「ふたり」)。左にロゴ(ホームへ)、右に
// ハンバーガーメニュー。メニューは開閉式で、ホーム・精算・精算履歴・設定へ
// どの画面からも1タップ+1選択で移動できる(従来はホーム経由の2タップが必要だった)。

const NAV_ITEMS = [
  { href: "/", label: "ホーム" },
  { href: "/settlement", label: "精算" },
  { href: "/settlements", label: "精算履歴" },
  { href: "/settings", label: "設定" },
] as const;

export default function AppHeader() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // メニュー経由以外の画面遷移(リダイレクト等)でも開いたまま残さない。
  // effect での setState は lint で禁止のため、render中の状態調整パターンで書く
  const [prevPathname, setPrevPathname] = useState(pathname);
  if (prevPathname !== pathname) {
    setPrevPathname(pathname);
    setOpen(false);
  }

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  // セットアップ中(世帯未所属)はメニュー先の画面がどれも使えないため出さない
  if (pathname.startsWith("/setup")) {
    return null;
  }

  // "/settlement" が "/settlements" に誤マッチしないよう、完全一致か
  // 「href + /」で始まる場合だけを現在地とする
  const isCurrent = (href: string) =>
    href === "/"
      ? pathname === "/"
      : pathname === href || pathname.startsWith(`${href}/`);

  return (
    // 注意: ここに backdrop-blur(backdrop-filter)を足さないこと。
    // ヘッダーが fixed 子要素(背面オーバーレイ)の containing block になり、
    // オーバーレイがヘッダーの箱内に閉じ込められて背面タップを拾えなくなる
    <header className="sticky top-0 z-40 border-b border-line bg-background">
      <div className="mx-auto flex w-full max-w-md items-center justify-between px-6 py-3">
        <Link href="/" className="text-lg font-bold" aria-label="ホームへ">
          warik<span className="text-me">app</span>
        </Link>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls="app-nav"
          aria-label={open ? "メニューを閉じる" : "メニューを開く"}
          className="-m-2 rounded-xl p-2 text-foreground"
        >
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden="true"
          >
            {open ? (
              <>
                <line x1="5" y1="5" x2="19" y2="19" />
                <line x1="19" y1="5" x2="5" y2="19" />
              </>
            ) : (
              <>
                <line x1="4" y1="6" x2="20" y2="6" />
                <line x1="4" y1="12" x2="20" y2="12" />
                <line x1="4" y1="18" x2="20" y2="18" />
              </>
            )}
          </svg>
        </button>
      </div>

      {open && (
        <>
          {/* 背面タップで閉じる。ヘッダーより背面(z-40のheader内でnavより先)に置く */}
          <div
            className="fixed inset-0 bg-foreground/20"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <nav
            id="app-nav"
            aria-label="メインメニュー"
            className="absolute inset-x-0 top-full"
          >
            <ul className="mx-auto w-full max-w-md space-y-1 rounded-b-2xl bg-surface p-3 shadow-card">
              {NAV_ITEMS.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    // 遷移後にメニューが開いたまま残らないようタップで閉じる
                    onClick={() => setOpen(false)}
                    aria-current={isCurrent(item.href) ? "page" : undefined}
                    className={`block rounded-xl px-4 py-3 text-sm font-bold ${
                      isCurrent(item.href)
                        ? "bg-me-soft text-me-strong"
                        : "text-foreground"
                    }`}
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </>
      )}
    </header>
  );
}
