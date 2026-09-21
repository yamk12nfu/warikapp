import { requireSignedIn } from "@/lib/server-auth";
import SettlementDetailClient from "./settlement-detail-client";

export default async function SettlementDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireSignedIn();
  const { id } = await params;
  return <SettlementDetailClient settlementId={id} />;
}
