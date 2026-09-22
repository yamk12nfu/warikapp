"use server";

import { clerkClient, auth } from "@clerk/nextjs/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { toUserMessage } from "@/lib/convex-error";

export async function deleteAccount(): Promise<
  { ok: true } | { ok: false; message: string }
> {
  const { userId, getToken } = await auth();
  if (!userId) {
    return { ok: false, message: "ログインしてください" };
  }

  const token = await getToken({ template: "convex" });
  if (token === null) {
    return { ok: false, message: "ログインしてください" };
  }

  try {
    const client = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
    client.setAuth(token);
    await client.mutation(api.couples.leaveCouple, {});
  } catch (caught) {
    return { ok: false, message: toUserMessage(caught) };
  }

  try {
    const client = await clerkClient();
    await client.users.deleteUser(userId);
  } catch {
    return {
      ok: false,
      message: "アカウントの削除に失敗しました。もう一度お試しください",
    };
  }

  return { ok: true };
}
