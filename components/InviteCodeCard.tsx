"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

// 招待コードと招待URLの表示・コピーUI(S-002 世帯作成直後 / S-009 設定で共用)
const expiresAtFormatter = new Intl.DateTimeFormat("ja-JP", {
  dateStyle: "medium",
  timeStyle: "short",
});

// ブラウザ限定の値(招待URLの組み立てに使うorigin)をレンダー中に安全に読む。
// サーバーレンダリング時は空文字を返す。
const neverChanges = () => () => {};
const getOrigin = () => window.location.origin;
const getServerOrigin = () => "";

export default function InviteCodeCard({
  code,
  expiresAt,
}: {
  code: string;
  expiresAt: number;
}) {
  const origin = useSyncExternalStore(neverChanges, getOrigin, getServerOrigin);
  const [isExpired, setIsExpired] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);

  // 期限切れの判定。表示中に期限を迎えたらそのタイミングで切り替わる
  useEffect(() => {
    const timer = setTimeout(
      () => setIsExpired(true),
      Math.max(0, expiresAt - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [expiresAt]);

  useEffect(() => {
    if (copied === null) {
      return;
    }
    const timer = setTimeout(() => setCopied(null), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  const inviteUrl = origin === "" ? "" : `${origin}/setup?code=${code}`;

  async function copy(label: string, text: string) {
    setCopyError(null);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
    } catch {
      setCopyError("コピーできませんでした。手動で選択してコピーしてください");
    }
  }

  return (
    <div className="rounded-2xl bg-surface p-4 space-y-3 shadow-card">
      <div>
        <p className="text-xs text-muted">招待コード</p>
        <p className="font-mono text-3xl font-bold tracking-[0.2em] break-all text-me-strong">
          {code}
        </p>
      </div>

      <p className={`text-xs ${isExpired ? "text-danger" : "text-muted"}`}>
        {isExpired
          ? "有効期限が切れています。再発行してください"
          : `有効期限: ${expiresAtFormatter.format(new Date(expiresAt))}`}
      </p>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => copy("code", code)}
          className="rounded-full border border-edge px-3 py-2 text-sm font-medium"
        >
          {copied === "code" ? "コピーしました" : "コードをコピー"}
        </button>
        <button
          type="button"
          onClick={() => copy("url", inviteUrl)}
          disabled={inviteUrl === ""}
          className="rounded-full border border-edge px-3 py-2 text-sm font-medium disabled:opacity-50"
        >
          {copied === "url" ? "コピーしました" : "招待URLをコピー"}
        </button>
      </div>

      {inviteUrl !== "" && (
        <p className="text-xs break-all text-muted">{inviteUrl}</p>
      )}
      {copyError !== null && (
        <p className="text-xs text-danger">{copyError}</p>
      )}
    </div>
  );
}
