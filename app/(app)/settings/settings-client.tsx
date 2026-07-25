"use client";

import { api } from "@/convex/_generated/api";
import InviteCodeCard from "@/components/InviteCodeCard";
import { toUserMessage } from "@/lib/convex-error";
import { SignOutButton } from "@clerk/nextjs";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";

const inputClass =
  "w-full rounded border border-black/15 bg-transparent px-3 py-2 text-base dark:border-white/25";

const buttonClass =
  "rounded-md border border-black/15 px-4 py-2 text-sm disabled:opacity-50 dark:border-white/25";

export default function SettingsClient() {
  const router = useRouter();
  // Convex側のJWT検証が完了するまでqueryを実行しない(Phase 3と同じ理由)
  const { isLoading, isAuthenticated } = useConvexAuth();
  const member = useQuery(
    api.couples.currentMember,
    isAuthenticated ? {} : "skip",
  );
  // household は requireMember で throw するため、所属済みが確定してから呼ぶ
  const household = useQuery(api.couples.household, member ? {} : "skip");

  const updateDisplayName = useMutation(api.couples.updateDisplayName);
  const reissueInvitation = useMutation(api.couples.reissueInvitation);

  // null = 未編集(サーバーの値をそのまま表示する)
  const [draftName, setDraftName] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [nameSaved, setNameSaved] = useState(false);
  const [savingName, setSavingName] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [reissuing, setReissuing] = useState(false);

  useEffect(() => {
    if (isAuthenticated && member === null) {
      router.replace("/setup");
    }
  }, [isAuthenticated, member, router]);

  async function handleRename(event: FormEvent) {
    event.preventDefault();
    if (draftName === null) {
      return;
    }
    setNameError(null);
    setNameSaved(false);
    setSavingName(true);
    try {
      await updateDisplayName({ displayName: draftName });
      setDraftName(null); // サーバーの値に追従させる
      setNameSaved(true);
    } catch (caught) {
      setNameError(toUserMessage(caught));
    } finally {
      setSavingName(false);
    }
  }

  async function handleReissue() {
    setInviteError(null);
    setReissuing(true);
    try {
      await reissueInvitation({});
    } catch (caught) {
      setInviteError(toUserMessage(caught));
    } finally {
      setReissuing(false);
    }
  }

  if (isLoading) {
    return <main className="p-8 text-gray-500">読み込み中…</main>;
  }
  if (!isAuthenticated) {
    return null; // 未ログイン: proxyが/loginへ誘導する
  }
  if (member === null) {
    return null; // 世帯未所属: /setupへ誘導中
  }
  if (member === undefined || household === undefined) {
    return <main className="p-8 text-gray-500">読み込み中…</main>;
  }

  const displayNameValue = draftName ?? household.self.displayName;

  return (
    <main className="mx-auto w-full max-w-md space-y-8 p-6">
      <div>
        <h1 className="text-xl font-bold">設定</h1>
        <Link href="/" className="text-sm text-blue-600 underline">
          ← ホームへ
        </Link>
      </div>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-gray-500">世帯</h2>
        <p className="text-base">{household.coupleName}</p>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-gray-500">あなたの表示名</h2>
        <form onSubmit={handleRename} className="space-y-2">
          <label htmlFor="display-name" className="sr-only">
            表示名
          </label>
          <input
            id="display-name"
            value={displayNameValue}
            onChange={(event) => {
              setDraftName(event.target.value);
              setNameSaved(false);
              setNameError(null); // 修正中に前回の失敗メッセージを残さない
            }}
            maxLength={20}
            required
            // 保存中は編集させない。送信値はクロージャで固定されるため、
            // 保存中に書き換えられるとその編集が完了時に破棄されてしまう
            disabled={savingName}
            className={`${inputClass} disabled:opacity-50`}
          />
          <button
            type="submit"
            disabled={savingName || draftName === null}
            className={buttonClass}
          >
            {savingName ? "保存中…" : "表示名を保存"}
          </button>
        </form>
        {nameSaved && <p className="text-sm text-green-700">保存しました</p>}
        {nameError !== null && (
          <p role="alert" className="text-sm text-red-600">
            {nameError}
          </p>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-gray-500">パートナー</h2>
        {household.partner !== null ? (
          <p className="text-base">{household.partner.displayName} さん</p>
        ) : (
          <>
            <p className="text-sm text-gray-500">
              まだ参加していません。招待コードを共有してください。
            </p>
            {household.invitation !== null ? (
              // keyでコードごとに作り直す。再発行時に期限切れ表示や
              // 「コピーしました」が前のコードのまま残らないようにする
              <InviteCodeCard
                key={household.invitation.code}
                code={household.invitation.code}
                expiresAt={household.invitation.expiresAt}
              />
            ) : (
              <p className="text-sm text-gray-500">
                有効な招待コードがありません。発行してください。
              </p>
            )}
            <button
              type="button"
              onClick={handleReissue}
              disabled={reissuing}
              className={buttonClass}
            >
              {reissuing
                ? "発行中…"
                : household.invitation === null
                  ? "招待コードを発行"
                  : "招待コードを再発行"}
            </button>
            <p className="text-xs text-gray-500">
              再発行すると、いま表示されているコードは使えなくなります。
            </p>
            {inviteError !== null && (
              <p role="alert" className="text-sm text-red-600">
                {inviteError}
              </p>
            )}
          </>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-gray-500">アカウント</h2>
        <SignOutButton redirectUrl="/login">
          <button type="button" className={`${buttonClass} text-red-600`}>
            ログアウト
          </button>
        </SignOutButton>
      </section>
    </main>
  );
}
