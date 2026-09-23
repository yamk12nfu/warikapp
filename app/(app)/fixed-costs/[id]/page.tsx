import { requireSignedIn } from "@/lib/server-auth";
import FixedCostDetailClient from "./fixed-cost-detail-client";

export default async function FixedCostDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireSignedIn();
  const { id } = await params;
  return <FixedCostDetailClient fixedCostId={id} />;
}
