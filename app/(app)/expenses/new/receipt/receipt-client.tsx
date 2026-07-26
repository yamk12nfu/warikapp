"use client";

import ExpenseEditor, {
  createInitialItem,
  type ExpenseFormValue,
} from "@/components/ExpenseEditor";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { toUserMessage } from "@/lib/convex-error";
import { todayLocalDate } from "@/lib/date";
import { compressReceiptImage } from "@/lib/image";
import type { ExpenseItemInput } from "@/lib/types";
import { useAction, useConvexAuth, useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChangeEvent, useEffect, useState } from "react";

// レシート登録(S-004 / F-003)。
// 撮影・選択 → クライアントで縮小圧縮 → アップロード → AI読み取り →
// ExpenseEditor で確認(この時点でドラフト保存)→ 確定、の順に進む。
//
// 失敗時の導線は要件の表どおりに分ける:
//   アップロード失敗 → 再試行(画像はこの画面が持ったまま)
//   読み取り失敗    → 「手入力に切り替えますか?」(storageIdは保持)
//   レシート以外    → 撮り直し + 手入力導線

type Phase = "select" | "working" | "editing";

const buttonClass =
  "w-full rounded-md border border-black/15 px-4 py-3 text-center text-sm font-medium disabled:opacity-50 dark:border-white/25";

const primaryButtonClass =
  "w-full rounded-md bg-foreground px-4 py-3 text-center text-sm font-medium text-background";

const ERR_UPLOAD = "アップロードに失敗しました";

// ExpenseEditor / expenses.save に渡す形へ。負担区分の初期値は「折半」
// (createInitialItem がその既定値を持っている)
function toEditorItems(
  items: { name: string; price: number; quantity: number }[],
  selfId: string,
  partnerId: string | null,
): ExpenseItemInput[] {
  return items.map((item) => ({
    ...createInitialItem(selfId, partnerId),
    name: item.name,
    price: item.price,
    quantity: item.quantity,
  }));
}

function toSaveItems(items: ExpenseItemInput[]) {
  return items.map((item) => ({
    ...item,
    shares: item.shares.map((share) => ({
      ...share,
      memberId: share.memberId as Id<"members">,
    })),
  }));
}

export default function ReceiptExpenseClient() {
  const router = useRouter();
  // Convex側のJWT検証が完了するまでqueryを実行しない(Phase 3と同じ理由)
  const { isLoading, isAuthenticated } = useConvexAuth();
  const member = useQuery(
    api.couples.currentMember,
    isAuthenticated ? {} : "skip",
  );
  // household は requireMember で throw するため、所属済みが確定してから呼ぶ
  const household = useQuery(api.couples.household, member ? {} : "skip");
  const generateUploadUrl = useMutation(api.uploads.generateUploadUrl);
  const registerUpload = useMutation(api.uploads.registerUpload);
  const discardUpload = useMutation(api.uploads.discard);
  const parseReceipt = useAction(api.receipts.parse);
  const saveExpense = useMutation(api.expenses.save);

  const [phase, setPhase] = useState<Phase>("select");
  const [progress, setProgress] = useState("");
  const [error, setError] = useState<string | null>(null);
  // 失敗した工程に応じて出すボタンを変える
  const [failedStep, setFailedStep] = useState<"upload" | "parse" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // 再試行のために、選んだ画像とアップロード済みの storageId を保持する
  const [file, setFile] = useState<File | null>(null);
  const [storageId, setStorageId] = useState<Id<"_storage"> | null>(null);
  const [expenseId, setExpenseId] = useState<Id<"expenses"> | null>(null);
  const [initialValue, setInitialValue] = useState<ExpenseFormValue | null>(
    null,
  );
  // ExpenseEditor は initialValue をマウント時にしか読まないので、
  // 読み取りをやり直したら別インスタンスとして作り直す
  const [editorKey, setEditorKey] = useState(0);

  useEffect(() => {
    // 認証確立後にnull = 本当に世帯未所属
    if (isAuthenticated && member === null) {
      router.replace("/setup");
    }
  }, [isAuthenticated, member, router]);

  async function upload(target: File): Promise<Id<"_storage">> {
    setProgress("画像を準備しています…");
    const blob = await compressReceiptImage(target);
    setProgress("アップロードしています…");
    const uploadUrl = await generateUploadUrl();
    const response = await fetch(uploadUrl, {
      method: "POST",
      headers: { "Content-Type": blob.type },
      body: blob,
    });
    if (!response.ok) {
      throw new Error(ERR_UPLOAD);
    }
    const { storageId: uploaded } = (await response.json()) as {
      storageId: Id<"_storage">;
    };
    // 台帳に自世帯のものとして記録する(以降のstorageId検証の根拠になる)
    await registerUpload({ storageId: uploaded });
    return uploaded;
  }

  // 読み取り → ドラフト保存 → 確認画面へ
  async function parseAndDraft(
    uploaded: Id<"_storage">,
    self: { _id: string },
    partnerId: string | null,
  ) {
    setProgress("レシートを読み取っています…");
    const parsed = await parseReceipt({ storageId: uploaded });

    const items = toEditorItems(parsed.items, self._id, partnerId);
    const value: ExpenseFormValue = {
      paidBy: self._id,
      storeName: parsed.storeName ?? "",
      // 購入日が読めなければ当日を既定にする
      purchasedAt: parsed.purchasedAt ?? todayLocalDate(),
      items,
    };

    setProgress("下書きを保存しています…");
    // 確定前に離脱しても入力が消えないよう、まずドラフトとして保存する
    const savedId = await saveExpense({
      expenseId: expenseId ?? undefined,
      paidBy: value.paidBy as Id<"members">,
      storeName: value.storeName === "" ? undefined : value.storeName,
      purchasedAt: value.purchasedAt,
      items: toSaveItems(items),
      source: "receipt",
      status: "draft",
      imageStorageId: uploaded,
    });

    setExpenseId(savedId);
    setInitialValue(value);
    setEditorKey((key) => key + 1);
    setNotice(
      parsed.adjustmentSkipped
        ? "レシートの合計金額と品目の合計が一致しません。金額を確認してください"
        : null,
    );
    setPhase("editing");
  }

  // reuse には「アップロード済みで、そのまま使い回してよい storageId」を渡す。
  // state の storageId を読まないのは、setStorageId(null) の直後に呼んでも
  // このレンダーのクロージャには古い値が残っており、撮り直したのに前の画像を
  // 読み取ってしまうため(stateの更新は非同期)。
  async function start(target: File, reuse: Id<"_storage"> | null) {
    if (household === undefined) {
      return;
    }
    setError(null);
    setFailedStep(null);
    setPhase("working");
    let uploaded = reuse;
    try {
      if (uploaded === null) {
        uploaded = await upload(target);
        setStorageId(uploaded);
      }
    } catch (caught) {
      // Convex由来のエラーは message に内部診断([CONVEX M(...)] …)が混ざるので
      // data から取り出す。圧縮など画面内で投げたエラーは message をそのまま出す
      setError(
        caught instanceof ConvexError
          ? toUserMessage(caught, ERR_UPLOAD)
          : caught instanceof Error && caught.message !== ""
            ? caught.message
            : ERR_UPLOAD,
      );
      setFailedStep("upload");
      setPhase("select");
      return;
    }
    try {
      await parseAndDraft(
        uploaded,
        household.self,
        household.partner?._id ?? null,
      );
    } catch (caught) {
      setError(toUserMessage(caught));
      setFailedStep("parse");
      setPhase("select");
    }
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0];
    // 同じファイルを選び直しても change が起きるように値をクリアする
    event.target.value = "";
    if (selected === undefined) {
      return;
    }
    // 撮り直しなので、前回のアップロード結果は捨てて必ず上げ直す。
    // 使わなくなった画像は削除する(支出に紐付いていれば discard 側で残される)。
    // 失敗しても撮り直しは続行する(掃除が目的で、ここで止める理由がない)
    const previous = storageId;
    if (previous !== null) {
      void discardUpload({ storageId: previous }).catch(() => {});
    }
    setFile(selected);
    setStorageId(null);
    void start(selected, null);
  }

  function retryUpload() {
    if (file !== null) {
      setStorageId(null);
      void start(file, null);
    }
  }

  function retryParse() {
    if (storageId !== null && household !== undefined) {
      setError(null);
      setFailedStep(null);
      setPhase("working");
      parseAndDraft(
        storageId,
        household.self,
        household.partner?._id ?? null,
      ).catch((caught) => {
        setError(toUserMessage(caught));
        setFailedStep("parse");
        setPhase("select");
      });
    }
  }

  // 読み取りを諦めて手入力に切り替える(画像は支出に紐付けたまま)
  function switchToManual() {
    if (household === undefined) {
      return;
    }
    const partnerId = household.partner?._id ?? null;
    setError(null);
    setFailedStep(null);
    setNotice("読み取り結果なしで開いています。品目を入力してください");
    setInitialValue({
      paidBy: household.self._id,
      storeName: "",
      purchasedAt: todayLocalDate(),
      items: [createInitialItem(household.self._id, partnerId)],
    });
    setEditorKey((key) => key + 1);
    setPhase("editing");
  }

  async function handleSubmit(value: ExpenseFormValue) {
    await saveExpense({
      expenseId: expenseId ?? undefined,
      paidBy: value.paidBy as Id<"members">,
      storeName: value.storeName.trim() === "" ? undefined : value.storeName,
      purchasedAt: value.purchasedAt,
      items: toSaveItems(value.items),
      source: "receipt",
      status: "confirmed",
      imageStorageId: storageId ?? undefined,
    });
    router.replace("/");
  }

  // 未認証の判定を query の読み込み判定より先に行う(Phase 5と同じ)
  if (isLoading) {
    return <main className="p-8 text-gray-500">読み込み中…</main>;
  }
  if (!isAuthenticated) {
    return null; // 未ログイン: proxyが/loginへ誘導する
  }
  if (member === undefined || (member !== null && household === undefined)) {
    return <main className="p-8 text-gray-500">読み込み中…</main>;
  }
  if (member === null || household === undefined) {
    return null; // 世帯未所属: /setupへ誘導中
  }

  return (
    <main className="mx-auto w-full max-w-md space-y-5 p-6">
      <div>
        <h1 className="text-xl font-bold">レシートから登録</h1>
        <p className="mt-1 text-sm text-gray-500">
          レシートを撮影すると、品目と金額をAIが読み取ります。
        </p>
      </div>

      {phase === "select" && (
        <div className="space-y-4">
          <label
            htmlFor="receipt-image"
            className={`${primaryButtonClass} block cursor-pointer`}
          >
            レシートを撮影・選択
          </label>
          <input
            id="receipt-image"
            type="file"
            accept="image/*"
            capture="environment"
            onChange={handleFileChange}
            className="sr-only"
          />

          {error !== null && (
            <div className="space-y-3 rounded-lg border border-red-500 p-3">
              <p role="alert" className="text-sm text-red-600">
                {error}
              </p>
              {failedStep === "upload" && file !== null && (
                <button
                  type="button"
                  onClick={retryUpload}
                  className={buttonClass}
                >
                  もう一度アップロードする
                </button>
              )}
              {failedStep === "parse" && (
                <>
                  {storageId !== null && (
                    <button
                      type="button"
                      onClick={retryParse}
                      className={buttonClass}
                    >
                      もう一度読み取る
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={switchToManual}
                    className={buttonClass}
                  >
                    手入力に切り替える
                  </button>
                </>
              )}
            </div>
          )}

          <Link
            href="/expenses/new/manual"
            className="block text-sm text-blue-600 underline"
          >
            レシートを使わずに手入力する
          </Link>
        </div>
      )}

      {phase === "working" && (
        <div className="space-y-3" aria-live="polite">
          <p className="text-sm text-gray-500">{progress}</p>
          {/* 読み取りは通常15秒以内。待ち時間をスケルトンで示す */}
          <div className="space-y-2">
            {[0, 1, 2].map((row) => (
              <div
                key={row}
                className="h-14 animate-pulse rounded-lg bg-black/10 dark:bg-white/15"
              />
            ))}
          </div>
        </div>
      )}

      {phase === "editing" && initialValue !== null && (
        <>
          {notice !== null && (
            <p className="rounded-lg border border-amber-500 p-3 text-sm text-amber-700 dark:text-amber-400">
              {notice}
            </p>
          )}
          <ExpenseEditor
            key={editorKey}
            self={household.self}
            partner={household.partner}
            initialValue={initialValue}
            submitLabel="この支出を確定する"
            submittingLabel="確定中…"
            onSubmit={handleSubmit}
          />
        </>
      )}

      <Link href="/" className="block text-sm text-blue-600 underline">
        ホームへ戻る
      </Link>
    </main>
  );
}
