import { SignIn } from "@clerk/nextjs";

export default function LoginPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 p-8">
      <div className="text-center">
        <h1 className="text-2xl font-bold">
          warik<span className="text-me">app</span>
        </h1>
        <p className="mt-1 text-sm text-muted">
          ふたりの立て替えを、レシートから精算
        </p>
      </div>
      <SignIn path="/login" fallbackRedirectUrl="/" />
    </main>
  );
}
