import { toReceiptItemMatchKey } from "./receipt";
import type { ShareRatio } from "./types";

export type ShareMemoryHousehold = {
  selfId: string;
  partnerId: string | null;
};

export type ShareMemoryExpense = {
  status: string;
  items: readonly {
    name: string;
    shares: readonly ShareRatio[];
  }[];
};

export function suggestReceiptItemSharesFromHistory(input: {
  itemNames: readonly string[];
  history: readonly ShareMemoryExpense[];
  household: ShareMemoryHousehold;
}): { sharesByItem: ShareRatio[][] } {
  const remembered = collapseShareMemory(input.history, input.household);
  const fallback = defaultShares(input.household);
  return {
    sharesByItem: input.itemNames.map((name) => {
      const key = toReceiptItemMatchKey(name);
      const hit = key === "" ? undefined : remembered.get(key);
      return copyShares(hit ?? fallback);
    }),
  };
}

function collapseShareMemory(
  history: readonly ShareMemoryExpense[],
  household: ShareMemoryHousehold,
): Map<string, ShareRatio[]> {
  const remembered = new Map<string, ShareRatio[]>();
  for (const expense of history) {
    if (expense.status !== "confirmed") {
      continue;
    }
    for (const item of [...expense.items].reverse()) {
      const key = toReceiptItemMatchKey(item.name);
      if (key === "" || remembered.has(key)) {
        continue;
      }
      const pattern = toValidSharePattern(item.shares);
      if (pattern === null) {
        continue;
      }
      const remapped = remapShares(pattern, household);
      if (toValidSharePattern(remapped) === null) {
        continue;
      }
      remembered.set(key, remapped);
    }
  }
  return remembered;
}

function toValidSharePattern(
  shares: readonly ShareRatio[],
): ShareRatio[] | null {
  if (shares.length === 0) {
    return null;
  }
  const seen = new Set<string>();
  let total = 0;
  const copy: ShareRatio[] = [];
  for (const share of shares) {
    if (seen.has(share.memberId)) {
      return null;
    }
    seen.add(share.memberId);
    if (
      !Number.isInteger(share.ratioPercent) ||
      share.ratioPercent < 0 ||
      share.ratioPercent > 100
    ) {
      return null;
    }
    total += share.ratioPercent;
    copy.push({
      memberId: share.memberId,
      ratioPercent: share.ratioPercent,
    });
  }
  return total === 100 ? copy : null;
}

function remapShares(
  shares: readonly ShareRatio[],
  household: ShareMemoryHousehold,
): ShareRatio[] {
  if (household.partnerId === null) {
    return [{ memberId: household.selfId, ratioPercent: 100 }];
  }
  return [
    {
      memberId: household.selfId,
      ratioPercent: ratioOf(shares, household.selfId),
    },
    {
      memberId: household.partnerId,
      ratioPercent: ratioOf(shares, household.partnerId),
    },
  ];
}

function defaultShares(household: ShareMemoryHousehold): ShareRatio[] {
  if (household.partnerId === null) {
    return [{ memberId: household.selfId, ratioPercent: 100 }];
  }
  return [
    { memberId: household.selfId, ratioPercent: 50 },
    { memberId: household.partnerId, ratioPercent: 50 },
  ];
}

function ratioOf(shares: readonly ShareRatio[], memberId: string): number {
  return shares.find((share) => share.memberId === memberId)?.ratioPercent ?? 0;
}

function copyShares(shares: readonly ShareRatio[]): ShareRatio[] {
  return shares.map((share) => ({ ...share }));
}
