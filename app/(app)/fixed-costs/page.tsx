import { requireSignedIn } from "@/lib/server-auth";
import { todayInJst } from "@/lib/date";
import FixedCostsClient from "./fixed-costs-client";

export default async function FixedCostsPage() {
  await requireSignedIn();
  return <FixedCostsClient month={todayInJst().slice(0, 7)} />;
}
