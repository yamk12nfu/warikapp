"use client";

import ShareRatioPicker, {
  isCustomPreset,
  ShareRatioInputs,
} from "@/components/ShareRatioPicker";
import {
  CATEGORIES,
  UNCATEGORIZED_LABEL,
  isStoredCategoryId,
  type CategoryId,
  type StoredCategoryId,
} from "@/lib/category";
import { toUserMessage } from "@/lib/convex-error";
import {
  inputClass,
  primaryButtonClass,
} from "@/lib/ui";
import type { ShareRatio } from "@/lib/types";
import { useState, type FormEvent } from "react";

type Member = { _id: string; displayName: string };

export type FixedCostInitialValue = {
  name: string;
  amount: number;
  paidBy: string;
  shares: ShareRatio[];
  category?: StoredCategoryId;
};

export type FixedCostFormValue = {
  name: string;
  amount: number;
  paidBy: string;
  shares: ShareRatio[];
  category: CategoryId;
  startMonth?: "this" | "next";
};

export default function FixedCostEditor({
  self,
  partner,
  initialValue,
  mode,
  onSubmit,
}: {
  self: Member;
  partner: Member | null;
  initialValue?: FixedCostInitialValue;
  mode: "create" | "edit";
  onSubmit: (value: FixedCostFormValue) => Promise<void>;
}) {
  const initialShares =
    initialValue?.shares ??
    (partner === null
      ? [{ memberId: self._id, ratioPercent: 100 }]
      : [
          { memberId: self._id, ratioPercent: 50 },
          { memberId: partner._id, ratioPercent: 50 },
        ]);
  const [name, setName] = useState(initialValue?.name ?? "");
  const [amount, setAmount] = useState(
    initialValue === undefined ? "" : String(initialValue.amount),
  );
  const [paidBy, setPaidBy] = useState(initialValue?.paidBy ?? self._id);
  const [shares, setShares] = useState(initialShares);
  const [custom, setCustom] = useState(() =>
    isCustomPreset(
      initialShares,
      self._id,
      partner === null ? null : partner._id,
    ),
  );
  const [category, setCategory] = useState<CategoryId>(
    initialValue?.category ?? "uncategorized",
  );
  const [startMonth, setStartMonth] = useState<"this" | "next">("this");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await onSubmit({
        name: name.trim(),
        amount: Number(amount),
        paidBy,
        shares: shares.filter((share) => share.ratioPercent > 0),
        category,
        ...(mode === "create" ? { startMonth } : {}),
      });
      if (mode === "edit") {
        setSubmitting(false);
      }
    } catch (caught) {
      setError(toUserMessage(caught));
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="space-y-4">
        <div className="space-y-1">
          <label htmlFor="fixed-cost-name" className="text-sm font-medium">
            名目
          </label>
          <input
            id="fixed-cost-name"
            aria-label="名目"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={50}
            required
            disabled={submitting}
            className={inputClass}
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="fixed-cost-amount" className="text-sm font-medium">
            金額
          </label>
          <input
            id="fixed-cost-amount"
            aria-label="金額"
            type="number"
            inputMode="numeric"
            min={1}
            max={9_999_999}
            step={1}
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            required
            disabled={submitting}
            className={inputClass}
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="fixed-cost-paid-by" className="text-sm font-medium">
            支払者
          </label>
          <select
            id="fixed-cost-paid-by"
            aria-label="支払者"
            value={paidBy}
            onChange={(event) => setPaidBy(event.target.value)}
            disabled={submitting}
            className={inputClass}
          >
            <option value={self._id}>{self.displayName}(あなた)</option>
            {partner !== null && (
              <option value={partner._id}>{partner.displayName}</option>
            )}
          </select>
        </div>

        <div className="space-y-1">
          <label htmlFor="fixed-cost-category" className="text-sm font-medium">
            分類
          </label>
          <select
            id="fixed-cost-category"
            aria-label="分類"
            value={category}
            onChange={(event) => {
              const next = event.target.value;
              if (next === "uncategorized" || isStoredCategoryId(next)) {
                setCategory(next);
              }
            }}
            disabled={submitting}
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

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">負担区分</h2>
        <div className="flex items-center gap-2">
          <ShareRatioPicker
            self={self}
            partner={partner}
            shares={shares}
            custom={custom}
            onSharesChange={setShares}
            onCustomChange={setCustom}
          />
        </div>
        {custom && partner !== null && (
          <ShareRatioInputs
            self={self}
            partner={partner}
            shares={shares}
            onSharesChange={setShares}
          />
        )}
      </section>

      {mode === "create" && (
        <fieldset className="space-y-2">
          <legend className="text-sm font-semibold">開始月</legend>
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                id="fixed-cost-start-this"
                name="fixed-cost-start-month"
                value="this"
                checked={startMonth === "this"}
                onChange={() => setStartMonth("this")}
                disabled={submitting}
              />
              今月分から
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                id="fixed-cost-start-next"
                name="fixed-cost-start-month"
                value="next"
                checked={startMonth === "next"}
                onChange={() => setStartMonth("next")}
                disabled={submitting}
              />
              来月分から
            </label>
          </div>
          <p className="text-xs text-muted">
            今月分はすぐに支出として計上されます。すでに手入力していれば来月分からを選んでください
          </p>
        </fieldset>
      )}

      {error !== null && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={submitting}
        className={`${primaryButtonClass} w-full`}
      >
        {submitting
          ? mode === "create"
            ? "登録中…"
            : "保存中…"
          : mode === "create"
            ? "この固定費を登録する"
            : "変更を保存する"}
      </button>
    </form>
  );
}
