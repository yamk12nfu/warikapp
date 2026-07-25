import { ConvexError } from "convex/values";

const FALLBACK_MESSAGE =
  "エラーが発生しました。時間をおいて再度お試しください";

// Convex関数が投げた ConvexError のメッセージを取り出す。
// 素の Error は本番デプロイでは内容がクライアントに届かない(「Server Error」に
// 伏せられる)ため、画面に出す想定のエラーはサーバー側で ConvexError にしてある。
// 想定外の例外はメッセージを露出させず、汎用文言にフォールバックする。
export function toUserMessage(
  error: unknown,
  fallback: string = FALLBACK_MESSAGE,
): string {
  if (error instanceof ConvexError && typeof error.data === "string") {
    return error.data;
  }
  return fallback;
}
