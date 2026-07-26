"use node";

import { ConvexError } from "convex/values";
import { ClaudeReceiptParser } from "./claude";
import { GeminiReceiptParser } from "./gemini";
import type { ReceiptParser } from "./types";

// プロバイダの選択。環境変数 RECEIPT_AI_PROVIDER(Convexダッシュボードで設定)で
// 切り替える。未設定なら claude。
// 環境変数は .env.local ではなく Convex 側に置くこと(actionはConvexで実行される)。

export function createReceiptParser(): ReceiptParser {
  const provider = process.env.RECEIPT_AI_PROVIDER ?? "claude";
  switch (provider) {
    case "claude":
      return new ClaudeReceiptParser();
    case "gemini":
      return new GeminiReceiptParser();
    default:
      // 設定ミスは画面にも出す(ダッシュボードの綴り間違いに気づけるように)
      throw new ConvexError(
        `未対応のAIプロバイダが設定されています: ${provider}`,
      );
  }
}

export type { ParsedReceipt, ReceiptParser } from "./types";
