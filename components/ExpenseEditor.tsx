"use client";

import { todayLocalDate } from "@/lib/date";
import { calcAdvanceAmount, calcTotalAmount } from "@/lib/settlement";
import type { ExpenseItemInput, ShareRatio } from "@/lib/types";
import { toUserMessage } from "@/lib/convex-error";
import { FormEvent, useRef, useState } from "react";

// 品目仕分けUI(F-004)。手入力(S-006)・レシート確認・編集(S-005)の3画面で共用する。
// 負担区分チップはタップで 折半 → 自分 → 相手 → 折半 と循環し、
// 「%」ボタンでカスタム割合(例 70:30)に切り替える。

const MAX_PRICE = 9_999_999;
const MAX_ITEM_NAME_LENGTH = 50;

export type EditorMember = { _id: string; displayName: string };

export type ExpenseFormValue = {
  paidBy: string;
  storeName: string;
  purchasedAt: string;
  items: ExpenseItemInput[];
};

type ItemRow = {
  key: string;
  name: string;
  priceText: string;
  quantity: number;
  shares: ShareRatio[]; // 常に [自分, 相手] の順(相手がいなければ自分のみ)
  custom: boolean; // カスタム割合の入力欄を開いているか
  // 一度でも編集された行か。まだ触っていない空行を赤枠にしないための判定
  touched: boolean;
};

const inputClass =
  "w-full rounded border border-black/15 bg-transparent px-3 py-2 text-base dark:border-white/25";

const submitClass =
  "w-full rounded-md bg-foreground px-4 py-3 text-base font-medium text-background disabled:opacity-50";

const chipClass =
  "rounded-full border border-black/15 px-3 py-2 text-sm font-medium whitespace-nowrap dark:border-white/25";

const yen = (amount: number) => `¥${amount.toLocaleString("ja-JP")}`;

// 金額は文字列で保持し、整数以外(小数・空欄・記号)は不正として扱う(V-403)
function parsePrice(priceText: string): number | null {
  const trimmed = priceText.trim();
  if (!/^\d+$/.test(trimmed)) {
    return null;
  }
  const price = Number(trimmed);
  if (price < 1 || price > MAX_PRICE) {
    return null;
  }
  return price;
}

// shares は memberId で引く(要素の並び順に依存しない)
function ratioOf(shares: ShareRatio[], memberId: string): number {
  return shares.find((share) => share.memberId === memberId)?.ratioPercent ?? 0;
}

// shares を [自分, 相手] の順に揃える(欠けている側は0%)。
// 表示中にパートナーが参加したときの正規化にも使う
function normalizeShares(
  shares: ShareRatio[],
  selfId: string,
  partnerId: string | null,
): ShareRatio[] {
  if (partnerId === null) {
    return [{ memberId: selfId, ratioPercent: 100 }];
  }
  return [
    { memberId: selfId, ratioPercent: ratioOf(shares, selfId) },
    { memberId: partnerId, ratioPercent: ratioOf(shares, partnerId) },
  ];
}

type Preset = "split" | "self" | "partner" | "custom";

function presetOf(
  shares: ShareRatio[],
  selfId: string,
  partnerId: string | null,
): Preset {
  const selfRatio = ratioOf(shares, selfId);
  if (partnerId === null) {
    return selfRatio === 100 ? "self" : "custom";
  }
  const partnerRatio = ratioOf(shares, partnerId);
  if (selfRatio === 50 && partnerRatio === 50) {
    return "split";
  }
  if (selfRatio === 100 && partnerRatio === 0) {
    return "self";
  }
  if (selfRatio === 0 && partnerRatio === 100) {
    return "partner";
  }
  return "custom";
}

const PRESET_LABEL: Record<Preset, string> = {
  split: "折半",
  self: "自分",
  partner: "相手",
  custom: "カスタム",
};

// 折半 → 自分 → 相手 → 折半 の循環(カスタムからは折半に戻す)
function nextPresetShares(
  shares: ShareRatio[],
  selfId: string,
  partnerId: string,
): ShareRatio[] {
  const ratios: Record<Preset, [number, number]> = {
    split: [100, 0], // 折半の次は「自分」
    self: [0, 100], // 自分の次は「相手」
    partner: [50, 50], // 相手の次は「折半」
    custom: [50, 50], // カスタムからは折半に戻す
  };
  const [selfRatio, partnerRatio] = ratios[presetOf(shares, selfId, partnerId)];
  return [
    { memberId: selfId, ratioPercent: selfRatio },
    { memberId: partnerId, ratioPercent: partnerRatio },
  ];
}

export function createInitialItem(
  selfId: string,
  partnerId: string | null,
): ExpenseItemInput {
  return {
    name: "",
    price: 0,
    quantity: 1,
    // 初期値は全品目「折半」(相手が未参加なら自分100%)
    shares:
      partnerId === null
        ? [{ memberId: selfId, ratioPercent: 100 }]
        : [
            { memberId: selfId, ratioPercent: 50 },
            { memberId: partnerId, ratioPercent: 50 },
          ],
  };
}

export default function ExpenseEditor({
  self,
  partner,
  initialValue,
  submitLabel,
  submittingLabel,
  onSubmit,
}: {
  self: EditorMember;
  partner: EditorMember | null;
  initialValue: ExpenseFormValue;
  submitLabel: string;
  submittingLabel: string;
  onSubmit: (value: ExpenseFormValue) => Promise<void>;
}) {
  const partnerId = partner === null ? null : partner._id;

  const [paidBy, setPaidBy] = useState(initialValue.paidBy);
  const [storeName, setStoreName] = useState(initialValue.storeName);
  const [purchasedAt, setPurchasedAt] = useState(initialValue.purchasedAt);
  const [rows, setRows] = useState<ItemRow[]>(() =>
    initialValue.items.map((item, index) => {
      const shares = normalizeShares(item.shares, self._id, partnerId);
      return {
        key: `row-${index}`,
        name: item.name,
        priceText: item.price === 0 ? "" : String(item.price),
        quantity: item.quantity,
        shares,
        custom: presetOf(shares, self._id, partnerId) === "custom",
        // 既存の支出を読み込んだ行は最初から検証結果を出す(空の新規行だけ抑える)
        touched: item.name !== "" || item.price !== 0,
      };
    }),
  );
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // 行の key は追加順の連番で採番する(SSRとクライアントで値がぶれない)
  const nextRowIndex = useRef(initialValue.items.length);

  // 入力中にパートナーが参加した場合、既存行の shares を [自分, 相手] に揃える。
  // (propsの変化に合わせてレンダー中にstateを調整するReactの推奨パターン。
  //  揃えないと相手の割合欄が空のまま「折半」に切り替えられなくなる)
  const [syncedPartnerId, setSyncedPartnerId] = useState(partnerId);
  if (syncedPartnerId !== partnerId) {
    setSyncedPartnerId(partnerId);
    setRows((current) =>
      current.map((row) => ({
        ...row,
        shares: normalizeShares(row.shares, self._id, partnerId),
      })),
    );
  }

  function updateRow(key: string, patch: Partial<ItemRow>) {
    setRows((current) =>
      current.map((row) => (row.key === key ? { ...row, ...patch } : row)),
    );
  }

  function addRow() {
    const key = `row-${nextRowIndex.current}`;
    nextRowIndex.current += 1;
    const item = createInitialItem(self._id, partnerId);
    setRows((current) => [
      ...current,
      {
        key,
        name: "",
        priceText: "",
        quantity: item.quantity,
        shares: item.shares,
        custom: false,
        touched: false,
      },
    ]);
  }

  function removeRow(key: string) {
    setRows((current) => current.filter((row) => row.key !== key));
  }

  function cyclePreset(row: ItemRow) {
    if (partnerId === null) {
      return; // 相手が未参加のうちは自分100%しかない
    }
    const shares = nextPresetShares(row.shares, self._id, partnerId);
    updateRow(row.key, { shares, custom: false, touched: true });
  }

  function setShareRatio(row: ItemRow, memberId: string, text: string) {
    if (!/^\d{0,3}$/.test(text)) {
      return; // 数字3桁までのみ受け付ける
    }
    const ratioPercent = text === "" ? 0 : Number(text);
    updateRow(row.key, {
      shares: row.shares.some((share) => share.memberId === memberId)
        ? row.shares.map((share) =>
            share.memberId === memberId ? { ...share, ratioPercent } : share,
          )
        : [...row.shares, { memberId, ratioPercent }],
      touched: true,
    });
  }

  // 行ごとの検証結果。V-401(割合合計)・V-403(金額)・品目名を判定する
  const checked = rows.map((row) => {
    const trimmedName = row.name.trim();
    const price = parsePrice(row.priceText);
    const shareTotal = row.shares.reduce(
      (total, share) => total + share.ratioPercent,
      0,
    );
    // 項目ごとのエラーはすべて出す(1件だけ出すと直した先に別のエラーが現れる)
    const errors: string[] = [];
    if (trimmedName.length < 1 || trimmedName.length > MAX_ITEM_NAME_LENGTH) {
      errors.push("品目名は1〜50文字で入力してください");
    }
    if (price === null) {
      errors.push("金額は1円以上の整数で入力してください"); // V-403
    }
    if (shareTotal !== 100) {
      errors.push(`負担割合の合計を100%にしてください(現在 ${shareTotal}%)`); // V-401
    }
    return {
      row,
      price,
      shareTotal,
      errors,
      // まだ触っていない空行は赤枠にしない(画面を開いた直後に全行が赤くなるのを防ぐ)
      showErrors: row.touched && errors.length > 0,
    };
  });

  const hasRowError = checked.some((item) => item.errors.length > 0);
  // 割合が100%でない行があるあいだ立て替え額は確定できない
  const shareIncomplete = checked.some((item) => item.shareTotal !== 100);
  const canSubmit = rows.length > 0 && !hasRowError && !submitting;

  // フッターの表示は金額が読める行だけで計算する(入力途中でも壊れないように)
  const previewItems: ExpenseItemInput[] = checked
    .filter((item) => item.price !== null)
    .map((item) => ({
      name: item.row.name.trim(),
      price: item.price as number,
      quantity: item.row.quantity,
      shares: item.row.shares,
    }));
  const totalAmount = calcTotalAmount(previewItems);
  const advanceAmount = calcAdvanceAmount(paidBy, previewItems);
  const payerName = paidBy === self._id ? "あなた" : (partner?.displayName ?? "");
  const otherName = paidBy === self._id ? (partner?.displayName ?? "") : "あなた";

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!canSubmit) {
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await onSubmit({
        paidBy,
        storeName,
        purchasedAt,
        items: checked.map((item) => ({
          name: item.row.name.trim(),
          price: item.price as number,
          quantity: item.row.quantity,
          // 0%の相手は保存しない(「自分100:相手0」は自分のみのsharesになる)
          shares: item.row.shares.filter((share) => share.ratioPercent > 0),
        })),
      });
      // 成功時は submitting を解除しない。親は画面遷移を始めるが遷移の完了は
      // await の後なので、ここで解除すると遷移前に再送信できてしまう
    } catch (caught) {
      setError(toUserMessage(caught));
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5 pb-40">
      <div className="space-y-4">
        <div className="space-y-1">
          <label htmlFor="store-name" className="text-sm font-medium">
            店名・名目(任意)
          </label>
          <input
            id="store-name"
            value={storeName}
            onChange={(event) => setStoreName(event.target.value)}
            maxLength={50}
            placeholder="スーパーやまだ / 焼肉"
            className={inputClass}
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="purchased-at" className="text-sm font-medium">
            購入日
          </label>
          <input
            id="purchased-at"
            type="date"
            value={purchasedAt}
            onChange={(event) => setPurchasedAt(event.target.value)}
            max={todayLocalDate()}
            required
            className={inputClass}
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="paid-by" className="text-sm font-medium">
            支払者
          </label>
          {partner === null ? (
            <p id="paid-by" className="text-base">
              {self.displayName}(あなた)
            </p>
          ) : (
            <select
              id="paid-by"
              value={paidBy}
              onChange={(event) => setPaidBy(event.target.value)}
              className={inputClass}
            >
              <option value={self._id}>{self.displayName}(あなた)</option>
              <option value={partner._id}>{partner.displayName}</option>
            </select>
          )}
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-semibold">品目</h2>
          <p className="text-xs text-gray-500">
            チップをタップで 折半 → 自分 → 相手
          </p>
        </div>

        {rows.length === 0 && (
          <p role="alert" className="text-sm text-red-600">
            品目を1件以上入力してください
          </p>
        )}

        {checked.map((item) => {
          const { row } = item;
          const preset = presetOf(row.shares, self._id, partnerId);
          return (
            <div
              key={row.key}
              className={`space-y-2 rounded-lg border p-3 ${
                item.showErrors
                  ? "border-red-500"
                  : "border-black/15 dark:border-white/25"
              }`}
            >
              <input
                value={row.name}
                onChange={(event) =>
                  updateRow(row.key, {
                    name: event.target.value,
                    touched: true,
                  })
                }
                maxLength={MAX_ITEM_NAME_LENGTH}
                placeholder="品目名(例: 牛肉)"
                aria-label="品目名"
                className={inputClass}
              />

              <div className="flex items-center gap-2">
                <div className="flex flex-1 items-center gap-1">
                  <span aria-hidden className="text-base">
                    ¥
                  </span>
                  <input
                    value={row.priceText}
                    onChange={(event) =>
                      updateRow(row.key, {
                        priceText: event.target.value,
                        touched: true,
                      })
                    }
                    inputMode="numeric"
                    maxLength={7}
                    placeholder="0"
                    aria-label="金額"
                    className={`${inputClass} text-right`}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => cyclePreset(row)}
                  aria-label={`負担区分: ${PRESET_LABEL[preset]}`}
                  className={`${chipClass} ${
                    preset === "custom"
                      ? ""
                      : "bg-foreground text-background border-transparent"
                  }`}
                >
                  {PRESET_LABEL[preset]}
                </button>
                {partner !== null && (
                  <button
                    type="button"
                    onClick={() =>
                      updateRow(row.key, { custom: !row.custom })
                    }
                    aria-label="カスタム割合を入力"
                    aria-pressed={row.custom}
                    className={chipClass}
                  >
                    %
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => removeRow(row.key)}
                  aria-label="この品目を削除"
                  className={`${chipClass} text-gray-500`}
                >
                  ×
                </button>
              </div>

              {row.custom && partner !== null && (
                <div className="flex items-center gap-3 text-sm">
                  <label className="flex items-center gap-1">
                    あなた
                    <input
                      value={String(ratioOf(row.shares, self._id))}
                      onChange={(event) =>
                        setShareRatio(row, self._id, event.target.value)
                      }
                      inputMode="numeric"
                      className="w-16 rounded border border-black/15 bg-transparent px-2 py-1 text-right dark:border-white/25"
                    />
                    %
                  </label>
                  <label className="flex items-center gap-1">
                    {partner.displayName}
                    <input
                      value={String(ratioOf(row.shares, partner._id))}
                      onChange={(event) =>
                        setShareRatio(row, partner._id, event.target.value)
                      }
                      inputMode="numeric"
                      className="w-16 rounded border border-black/15 bg-transparent px-2 py-1 text-right dark:border-white/25"
                    />
                    %
                  </label>
                </div>
              )}

              {item.showErrors && (
                <ul role="alert" className="space-y-0.5 text-xs text-red-600">
                  {item.errors.map((message) => (
                    <li key={message}>{message}</li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}

        <button
          type="button"
          onClick={addRow}
          className="w-full rounded-md border border-dashed border-black/25 px-4 py-3 text-sm font-medium dark:border-white/35"
        >
          + 品目を追加
        </button>
      </div>

      {error !== null && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}

      <div className="fixed inset-x-0 bottom-0 border-t border-black/10 bg-background p-4 dark:border-white/20">
        <div className="mx-auto w-full max-w-md space-y-2">
          <div className="flex items-baseline justify-between">
            <span className="text-sm text-gray-500">合計</span>
            <span className="text-lg font-bold">{yen(totalAmount)}</span>
          </div>
          <div className="flex items-baseline justify-between">
            <span className="text-sm text-gray-500">立て替え額</span>
            <span className="text-sm">
              {shareIncomplete
                ? "—" /* 割合が未確定のあいだは金額を出さない(誤解を招くため) */
                : advanceAmount === 0
                  ? "なし"
                  : `${payerName} → ${otherName} ${yen(advanceAmount)}`}
            </span>
          </div>
          {/* 確定できない理由を控えめに示す(空行を赤枠にしない代わりの案内) */}
          {!canSubmit && !submitting && (
            <p className="text-xs text-gray-500">
              {rows.length === 0
                ? "品目を1件以上入力してください"
                : shareIncomplete
                  ? "負担割合の合計を100%にしてください"
                  : "品目名と金額を入力すると登録できます"}
            </p>
          )}
          <button type="submit" disabled={!canSubmit} className={submitClass}>
            {submitting ? submittingLabel : submitLabel}
          </button>
        </div>
      </div>
    </form>
  );
}
