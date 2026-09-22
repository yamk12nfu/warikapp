import { parseBookMonth } from "@/lib/month-book";
import { requireSignedIn } from "@/lib/server-auth";
import { linkClass } from "@/lib/ui";
import Link from "next/link";
import MonthBookClient from "./month-book-client";

export default async function MonthBookPage({
  params,
}: {
  params: Promise<{ month: string }>;
}) {
  await requireSignedIn();
  const { month: raw } = await params;
  const month = parseBookMonth(raw);
  if (month === null) {
    return (
      <main className="mx-auto w-full max-w-md space-y-4 p-6">
        <p className="text-sm">月の指定が正しくありません</p>
        <Link href="/months" className={linkClass}>
          今月へ
        </Link>
      </main>
    );
  }
  return <MonthBookClient month={month} />;
}
