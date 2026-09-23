"use client";

import {
  CATEGORIES,
  UNCATEGORIZED_LABEL,
  isStoredCategoryId,
  type CategoryId,
} from "@/lib/category";
import { todayLocalDate } from "@/lib/date";
import { formatYen } from "@/lib/format";
import { calcAdvanceAmount, calcTotalAmount } from "@/lib/settlement";
import {
  originAfterNameEdit,
  originAfterShareEdit,
  originOrDefault,
  showsHistoryBadge,
  type InitialShareOrigin,
  type ShareOrigin,
} from "@/lib/share-origin";
import type { ExpenseItemInput, ShareRatio } from "@/lib/types";
import { toUserMessage } from "@/lib/convex-error";
import { amountClass, inputClass } from "@/lib/ui";
import ShareRatioPicker, {
  isCustomPreset,
  ShareRatioInputs,
} from "@/components/ShareRatioPicker";
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
  category: CategoryId;
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
  shareOrigin: ShareOrigin;
};

const submitClass =
  "w-full rounded-full bg-me px-4 py-3 text-base font-bold text-on-accent disabled:opacity-50";

const chipClass =
  "rounded-full border border-edge px-3 py-2 text-sm font-bold whitespace-nowrap";

const yen = formatYen;

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
  initialShareOrigins,
  submitLabel,
  submittingLabel,
  onSubmit,
}: {
  self: EditorMember;
  partner: EditorMember | null;
  initialValue: ExpenseFormValue;
  initialShareOrigins?: readonly InitialShareOrigin[];
  submitLabel: string;
  submittingLabel: string;
  onSubmit: (value: ExpenseFormValue) => Promise<void>;
}) {
  const partnerId = partner === null ? null : partner._id;

  const [paidBy, setPaidBy] = useState(initialValue.paidBy);
  const [storeName, setStoreName] = useState(initialValue.storeName);
  const [purchasedAt, setPurchasedAt] = useState(initialValue.purchasedAt);
  const [category, setCategory] = useState<CategoryId>(initialValue.category);
  const [rows, setRows] = useState<ItemRow[]>(() =>
    initialValue.items.map((item, index) => {
      const shares = normalizeShares(item.shares, self._id, partnerId);
      return {
        key: `row-${index}`,
        name: item.name,
        priceText: item.price === 0 ? "" : String(item.price),
        quantity: item.quantity,
        shares,
        custom: isCustomPreset(shares, self._id, partnerId),
        // 既存の支出を読み込んだ行は最初から検証結果を出す(空の新規行だけ抑える)
        touched: item.name !== "" || item.price !== 0,
        shareOrigin: originOrDefault(initialShareOrigins?.[index]),
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
        shareOrigin: "default",
      },
    ]);
  }

  function removeRow(key: string) {
    setRows((current) => current.filter((row) => row.key !== key));
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
        category,
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

        <div className="space-y-1">
          <label htmlFor="expense-category" className="text-sm font-medium">
            分類
          </label>
          <select
            id="expense-category"
            value={category}
            onChange={(event) => {
              const next = event.target.value;
              if (next === "uncategorized" || isStoredCategoryId(next)) {
                setCategory(next);
              }
            }}
            className={inputClass}
          >
            <option value="uncategorized">{UNCATEGORIZED_LABEL}</option>
            {CATEGORIES.map((row) => (
              <option key={row.id} value={row.id}>
                {row.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-semibold">品目</h2>
          <p className="text-xs text-muted">
            チップをタップで 折半 → 自分 → 相手
          </p>
        </div>

        {rows.length === 0 && (
          <p role="alert" className="text-sm text-danger">
            品目を1件以上入力してください
          </p>
        )}

        {checked.map((item) => {
          const { row } = item;
          return (
            <div
              key={row.key}
              className={`space-y-2 rounded-2xl bg-surface p-3 shadow-card ${
                item.showErrors ? "border border-danger" : ""
              }`}
            >
              <div className="flex items-center gap-2">
                <input
                  value={row.name}
                  onChange={(event) =>
                    updateRow(row.key, {
                      name: event.target.value,
                      touched: true,
                      shareOrigin: originAfterNameEdit(row.shareOrigin),
                    })
                  }
                  maxLength={MAX_ITEM_NAME_LENGTH}
                  placeholder="品目名(例: 牛肉)"
                  aria-label="品目名"
                  className={`${inputClass} min-w-0 flex-1`}
                />
                <button
                  type="button"
                  onClick={() => removeRow(row.key)}
                  aria-label="この品目を削除"
                  className={`${chipClass} text-muted`}
                >
                  ×
                </button>
              </div>

              <div className="flex items-center gap-2">
                <div className="flex min-w-0 flex-1 items-center gap-1">
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
                <ShareRatioPicker
                  self={self}
                  partner={partner}
                  shares={row.shares}
                  custom={row.custom}
                  suggested={showsHistoryBadge(row.shareOrigin)}
                  onSharesChange={(shares) =>
                    updateRow(row.key, {
                      shares,
                      touched: true,
                      shareOrigin: originAfterShareEdit(row.shareOrigin),
                    })
                  }
                  onCustomChange={(custom) =>
                    updateRow(row.key, {
                      custom,
                      shareOrigin: originAfterShareEdit(row.shareOrigin),
                    })
                  }
                />
              </div>

              {row.custom && partner !== null && (
                <ShareRatioInputs
                  self={self}
                  partner={partner}
                  shares={row.shares}
                  onSharesChange={(shares) =>
                    updateRow(row.key, {
                      shares,
                      touched: true,
                      shareOrigin: originAfterShareEdit(row.shareOrigin),
                    })
                  }
                />
              )}

              {item.showErrors && (
                <ul role="alert" className="space-y-0.5 text-xs text-danger">
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
          className="w-full rounded-full border border-dashed border-edge px-4 py-3 text-sm font-medium text-muted"
        >
          + 品目を追加
        </button>
      </div>

      {error !== null && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}

      <div className="fixed inset-x-0 bottom-0 border-t border-line bg-surface p-4">
        <div className="mx-auto w-full max-w-md space-y-2">
          <div className="flex items-baseline justify-between">
            <span className="text-sm text-muted">合計</span>
            <span className={`text-lg ${amountClass}`}>{yen(totalAmount)}</span>
          </div>
          <div className="flex items-baseline justify-between">
            <span className="text-sm text-muted">立て替え額</span>
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
            <p className="text-xs text-muted">
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
