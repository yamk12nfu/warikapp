"use client";

import FixedCostEditor, {
  type FixedCostFormValue,
} from "@/components/FixedCostEditor";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { toStoredCategory } from "@/lib/category";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function FixedCostNewClient() {
  const router = useRouter();
  const { isLoading, isAuthenticated } = useConvexAuth();
  const member = useQuery(
    api.couples.currentMember,
    isAuthenticated ? {} : "skip",
  );
  const household = useQuery(api.couples.household, member ? {} : "skip");
  const saveFixedCost = useMutation(api.fixedCosts.save);

  useEffect(() => {
    if (isAuthenticated && member === null) {
      router.replace("/setup");
    }
  }, [isAuthenticated, member, router]);

  async function handleSubmit(value: FixedCostFormValue) {
    await saveFixedCost({
      name: value.name,
      amount: value.amount,
      paidBy: value.paidBy as Id<"members">,
      shares: value.shares.map((share) => ({
        ...share,
        memberId: share.memberId as Id<"members">,
      })),
      category: toStoredCategory(value.category) ?? null,
      startMonth: value.startMonth ?? "this",
    });
    router.replace("/fixed-costs");
  }

  if (isLoading) {
    return <main className="p-8 text-muted">読み込み中…</main>;
  }
  if (!isAuthenticated) {
    return null;
  }
  if (member === undefined || (member !== null && household === undefined)) {
    return <main className="p-8 text-muted">読み込み中…</main>;
  }
  if (member === null || household === undefined) {
    return null;
  }

  return (
    <main className="mx-auto w-full max-w-md space-y-5 p-6">
      <div>
        <Link
          href="/fixed-costs"
          className="text-sm font-medium text-me-strong underline underline-offset-4"
        >
          ← 固定費一覧
        </Link>
        <h1 className="mt-2 text-xl font-bold">固定費を追加</h1>
      </div>
      <FixedCostEditor
        self={household.self}
        partner={household.partner}
        mode="create"
        onSubmit={handleSubmit}
      />
    </main>
  );
}
