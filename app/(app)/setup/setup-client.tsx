"use client";

import { api } from "@/convex/_generated/api";
import InviteCodeCard from "@/components/InviteCodeCard";
import { toUserMessage } from "@/lib/convex-error";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useRef, useState } from "react";

type Tab = "create" | "join";

const tabClass = (active: boolean) =>
  `flex-1 rounded-md px-3 py-2 text-sm font-medium ${
    active
      ? "bg-foreground text-background"
      : "border border-black/15 dark:border-white/25"
  }`;

const inputClass =
  "w-full rounded border border-black/15 bg-transparent px-3 py-2 text-base dark:border-white/25";

const submitClass =
  "w-full rounded-md bg-foreground px-4 py-3 text-base font-medium text-background disabled:opacity-50";

export default function SetupClient({ initialCode }: { initialCode: string }) {
  const router = useRouter();
  // Convex側のJWT検証が完了するまでqueryを実行しない(Phase 3と同じ理由)
  const { isLoading, isAuthenticated } = useConvexAuth();
  const member = useQuery(
    api.couples.currentMember,
    isAuthenticated ? {} : "skip",
  );
  const createCouple = useMutation(api.couples.createCouple);
  const joinCouple = useMutation(api.couples.joinCouple);

  const [tab, setTab] = useState<Tab>(initialCode === "" ? "create" : "join");
  const [displayName, setDisplayName] = useState("");
  const [coupleName, setCoupleName] = useState("");
  const [code, setCode] = useState(initialCode);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [invitation, setInvitation] = useState<{
    code: string;
    expiresAt: number;
  } | null>(null);

  // 世帯作成直後は招待コードを見せたいので、所属済み判定によるホームへの
  // 自動リダイレクトを止める(refなので再レンダリング順に左右されない)
  const stayOnPage = useRef(false);

  useEffect(() => {
    // 所属済みのユーザーがURL直打ちで来た場合はホームへ戻す
    if (member != null && !stayOnPage.current) {
      router.replace("/");
    }
  }, [member, router]);

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    stayOnPage.current = true;
    try {
      const issued = await createCouple({
        displayName,
        coupleName: coupleName.trim() === "" ? undefined : coupleName,
      });
      setInvitation(issued);
      setSubmitting(false);
    } catch (caught) {
      stayOnPage.current = false;
      setError(toUserMessage(caught));
      setSubmitting(false);
    }
  }

  async function handleJoin(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await joinCouple({ code, displayName });
      router.replace("/");
    } catch (caught) {
      setError(toUserMessage(caught));
      setSubmitting(false);
    }
  }

  if (isLoading || (isAuthenticated && member === undefined)) {
    return <main className="p-8 text-gray-500">読み込み中…</main>;
  }
  if (!isAuthenticated) {
    return null; // 未ログイン: proxyが/loginへ誘導する
  }
  if (member != null && invitation === null) {
    return null; // 所属済み: ホームへ誘導中
  }

  // 世帯作成後: 招待コードを共有してもらう
  if (invitation !== null) {
    return (
      <main className="mx-auto w-full max-w-md space-y-6 p-6">
        <div>
          <h1 className="text-xl font-bold">世帯を作成しました</h1>
          <p className="mt-1 text-sm text-gray-500">
            この招待コード(または招待URL)をパートナーに共有してください。
            コードは設定画面からいつでも確認・再発行できます。
          </p>
        </div>
        <InviteCodeCard
          code={invitation.code}
          expiresAt={invitation.expiresAt}
        />
        <Link href="/" className={`${submitClass} block text-center`}>
          ホームへ
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-md space-y-6 p-6">
      <div>
        <h1 className="text-xl font-bold">世帯のセットアップ</h1>
        <p className="mt-1 text-sm text-gray-500">
          支出を共有する相手と「世帯」を組みます。どちらか一方が作成し、
          もう一方が招待コードで参加してください。
        </p>
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => {
            setTab("create");
            setError(null);
          }}
          className={tabClass(tab === "create")}
        >
          世帯を作る
        </button>
        <button
          type="button"
          onClick={() => {
            setTab("join");
            setError(null);
          }}
          className={tabClass(tab === "join")}
        >
          招待コードで参加
        </button>
      </div>

      {tab === "create" ? (
        <form onSubmit={handleCreate} className="space-y-4">
          <div className="space-y-1">
            <label htmlFor="create-display-name" className="text-sm font-medium">
              あなたの表示名
            </label>
            <input
              id="create-display-name"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              maxLength={20}
              required
              placeholder="たろう"
              className={inputClass}
            />
            <p className="text-xs text-gray-500">1〜20文字</p>
          </div>
          <div className="space-y-1">
            <label htmlFor="couple-name" className="text-sm font-medium">
              世帯名(任意)
            </label>
            <input
              id="couple-name"
              value={coupleName}
              onChange={(event) => setCoupleName(event.target.value)}
              maxLength={30}
              placeholder="わたしたち"
              className={inputClass}
            />
            <p className="text-xs text-gray-500">
              未入力の場合は「わたしたち」になります
            </p>
          </div>
          <button type="submit" disabled={submitting} className={submitClass}>
            {submitting ? "作成中…" : "世帯を作成する"}
          </button>
        </form>
      ) : (
        <form onSubmit={handleJoin} className="space-y-4">
          <div className="space-y-1">
            <label htmlFor="invite-code" className="text-sm font-medium">
              招待コード
            </label>
            <input
              id="invite-code"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              maxLength={16}
              required
              autoCapitalize="characters"
              placeholder="ABCD2345"
              className={`${inputClass} font-mono tracking-[0.2em] uppercase`}
            />
            <p className="text-xs text-gray-500">
              パートナーが発行した8文字のコード
            </p>
          </div>
          <div className="space-y-1">
            <label htmlFor="join-display-name" className="text-sm font-medium">
              あなたの表示名
            </label>
            <input
              id="join-display-name"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              maxLength={20}
              required
              placeholder="はなこ"
              className={inputClass}
            />
            <p className="text-xs text-gray-500">1〜20文字</p>
          </div>
          <button type="submit" disabled={submitting} className={submitClass}>
            {submitting ? "参加中…" : "この世帯に参加する"}
          </button>
        </form>
      )}

      {error !== null && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
    </main>
  );
}
