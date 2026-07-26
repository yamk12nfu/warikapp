"use node";

import { ConvexError } from "convex/values";
import { ClaudeReceiptParser } from "./claude";
import { GeminiReceiptParser } from "./gemini";
import type { ReceiptParser } from "./types";

// プロバイダの選択。環境変数 RECEIPT_AI_PROVIDER(Convexダッシュボードで設定)で
// 切り替える。未設定なら gemini。
//
// 既定を Gemini にしている理由: レシートのOCRはFlash系で十分な精度が出るうえ、
// 月100枚でも数十円で収まる(Claude Opusだと10倍以上)。精度を比べたいときは
// RECEIPT_AI_PROVIDER=claude に変えれば同じ画面のまま切り替わる(TBD-001/006)。
//
// 環境変数は .env.local ではなく Convex 側に置くこと(actionはConvexで実行される)。

export function createReceiptParser(): ReceiptParser {
  const provider = process.env.RECEIPT_AI_PROVIDER ?? "gemini";
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
