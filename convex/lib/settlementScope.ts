import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import {
  settlementStateOf,
  type ExpenseSettlementState,
} from "../../lib/settlement";

export type SettlementScope = {
  pending: Doc<"settlements"> | null;
  pendingId: Id<"settlements"> | null;
  stateOf(expense: Pick<Doc<"expenses">, "settlementId">): ExpenseSettlementState;
};

export async function findPendingSettlement(
  ctx: QueryCtx | MutationCtx,
  coupleId: Id<"couples">,
): Promise<Doc<"settlements"> | null> {
  return await ctx.db
    .query("settlements")
    .withIndex("by_coupleId_and_status", (q) =>
      q.eq("coupleId", coupleId).eq("status", "pending"),
    )
    .unique();
}

export async function loadSettlementScope(
  ctx: QueryCtx | MutationCtx,
  coupleId: Id<"couples">,
): Promise<SettlementScope> {
  const pending = await findPendingSettlement(ctx, coupleId);
  return {
    pending,
    pendingId: pending?._id ?? null,
    stateOf: (expense) => settlementStateOf(expense.settlementId, pending?._id ?? null),
  };
}

export type SettlementPhase = "pending" | "completed";

export function phaseOf(settlement: Doc<"settlements">): SettlementPhase {
  return settlement.status ?? "completed";
}
