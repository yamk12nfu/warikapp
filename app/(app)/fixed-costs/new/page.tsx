import { requireSignedIn } from "@/lib/server-auth";
import FixedCostNewClient from "./fixed-cost-new-client";

export default async function NewFixedCostPage() {
  await requireSignedIn();
  return <FixedCostNewClient />;
}
