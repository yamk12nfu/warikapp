import { todayInJst } from "@/lib/date";
import { requireSignedIn } from "@/lib/server-auth";
import { redirect } from "next/navigation";

export default async function MonthsIndexPage() {
  await requireSignedIn();
  redirect(`/months/${todayInJst().slice(0, 7)}`);
}
