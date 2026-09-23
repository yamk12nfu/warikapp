"use client";

import type { CSSProperties } from "react";
import type { ShareRatio } from "@/lib/types";

type Member = { _id: string; displayName: string };
type Preset = "split" | "self" | "partner" | "custom";

function ratioOf(shares: ShareRatio[], memberId: string): number {
  return shares.find((share) => share.memberId === memberId)?.ratioPercent ?? 0;
}

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

export function isCustomPreset(
  shares: ShareRatio[],
  selfId: string,
  partnerId: string | null,
): boolean {
  return presetOf(shares, selfId, partnerId) === "custom";
}

const PRESET_LABEL: Record<Preset, string> = {
  split: "折半",
  self: "自分",
  partner: "相手",
  custom: "カスタム",
};

const PRESET_CHIP_CLASS: Record<Preset, string> = {
  split: "border-transparent text-on-accent",
  self: "border-transparent bg-me text-on-accent",
  partner: "border-transparent bg-partner text-on-accent",
  custom: "",
};

const PRESET_CHIP_STYLE: Partial<Record<Preset, CSSProperties>> = {
  split: {
    background: "linear-gradient(90deg, var(--me) 50%, var(--partner) 50%)",
  },
};

export function nextPresetShares(
  shares: ShareRatio[],
  selfId: string,
  partnerId: string,
): ShareRatio[] {
  const ratios: Record<Preset, [number, number]> = {
    split: [100, 0],
    self: [0, 100],
    partner: [50, 50],
    custom: [50, 50],
  };
  const [selfRatio, partnerRatio] = ratios[presetOf(shares, selfId, partnerId)];
  return [
    { memberId: selfId, ratioPercent: selfRatio },
    { memberId: partnerId, ratioPercent: partnerRatio },
  ];
}

export function ShareRatioInputs({
  self,
  partner,
  shares,
  onSharesChange,
}: {
  self: Member;
  partner: Member;
  shares: ShareRatio[];
  onSharesChange: (shares: ShareRatio[]) => void;
}) {
  function setShareRatio(memberId: string, text: string) {
    if (!/^\d{0,3}$/.test(text)) {
      return;
    }
    const ratioPercent = text === "" ? 0 : Number(text);
    onSharesChange(
      shares.some((share) => share.memberId === memberId)
        ? shares.map((share) =>
            share.memberId === memberId ? { ...share, ratioPercent } : share,
          )
        : [...shares, { memberId, ratioPercent }],
    );
  }

  return (
    <div className="flex items-center gap-3 text-sm">
      <label className="flex items-center gap-1">
        あなた
        <input
          value={String(ratioOf(shares, self._id))}
          onChange={(event) => setShareRatio(self._id, event.target.value)}
          inputMode="numeric"
          className="w-16 rounded-lg border border-edge bg-surface px-2 py-1 text-right tabular-nums"
        />
        %
      </label>
      <label className="flex items-center gap-1">
        {partner.displayName}
        <input
          value={String(ratioOf(shares, partner._id))}
          onChange={(event) => setShareRatio(partner._id, event.target.value)}
          inputMode="numeric"
          className="w-16 rounded-lg border border-edge bg-surface px-2 py-1 text-right tabular-nums"
        />
        %
      </label>
    </div>
  );
}

export default function ShareRatioPicker({
  self,
  partner,
  shares,
  custom,
  onSharesChange,
  onCustomChange,
}: {
  self: Member;
  partner: Member | null;
  shares: ShareRatio[];
  custom: boolean;
  onSharesChange: (shares: ShareRatio[]) => void;
  onCustomChange: (custom: boolean) => void;
}) {
  const partnerId = partner?._id ?? null;
  const preset = presetOf(shares, self._id, partnerId);

  function cyclePreset() {
    if (partnerId === null) {
      return;
    }
    onSharesChange(nextPresetShares(shares, self._id, partnerId));
    onCustomChange(false);
  }

  return (
    <>
      <button
        type="button"
        onClick={cyclePreset}
        aria-label={`負担区分: ${PRESET_LABEL[preset]}`}
        className={`rounded-full border border-edge px-3 py-2 text-sm font-bold whitespace-nowrap ${PRESET_CHIP_CLASS[preset]}`}
        style={PRESET_CHIP_STYLE[preset]}
      >
        {PRESET_LABEL[preset]}
      </button>
      {partner !== null && (
        <>
          <button
            type="button"
            onClick={() => onCustomChange(!custom)}
            aria-label="カスタム割合を入力"
            aria-pressed={custom}
            className="rounded-full border border-edge px-3 py-2 text-sm font-bold whitespace-nowrap"
          >
            %
          </button>
        </>
      )}
    </>
  );
}
