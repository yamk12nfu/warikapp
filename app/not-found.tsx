import { linkClass } from "@/lib/ui";
import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto w-full max-w-md space-y-6 p-6">
      <header className="space-y-2">
        <h1 className="text-xl font-bold">ページが見つかりません</h1>
        <p className="text-sm text-muted">
          URL が間違っているか、ページが移動した可能性があります。
        </p>
      </header>
      <Link href="/" className={linkClass}>
        ホームへ戻る
      </Link>
    </main>
  );
}
