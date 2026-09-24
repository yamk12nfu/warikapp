"use client";

import { useState } from "react";
import type { ReactNode } from "react";

const buttonClass =
  "rounded-full border border-edge bg-surface px-4 py-2 text-sm font-medium disabled:opacity-50";

export default function DangerActionConfirm({
  label,
  description,
  confirmLabel,
  pendingLabel,
  blockerMessage,
  error,
  onConfirm,
}: {
  label: string;
  description: string;
  confirmLabel: string;
  pendingLabel: string;
  blockerMessage: ReactNode;
  error: string | null;
  onConfirm: () => Promise<void>;
}) {
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleConfirm() {
    setSubmitting(true);
    try {
      await onConfirm();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-3">
      {!confirming && (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className={`${buttonClass} text-danger`}
        >
          {label}
        </button>
      )}
      {confirming && (
        <div className="space-y-3 rounded-2xl border border-edge bg-surface p-4">
          <p className="text-sm text-muted">{description}</p>
          {blockerMessage !== null && (
            <p role="alert" className="text-sm text-danger">
              {blockerMessage}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleConfirm}
              disabled={submitting || blockerMessage !== null}
              className={`${buttonClass} text-danger`}
            >
              {submitting ? pendingLabel : confirmLabel}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={submitting}
              className={buttonClass}
            >
              やめる
            </button>
          </div>
        </div>
      )}
      {error !== null && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
