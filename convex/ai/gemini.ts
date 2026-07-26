"use node";

import { GoogleGenAI } from "@google/genai";
import {
  ReceiptSchemaError,
  type ParsedReceipt,
  type ReceiptMediaType,
  type ReceiptParseOptions,
  type ReceiptParser,
} from "./types";
import { PROMPT, ReceiptSchema, receiptJsonSchema } from "./schema";
import { requireApiKey, resolveModel } from "./config";

// Gemini によるレシート読み取り(TBD-006)。
// 構造化出力(responseMimeType + responseJsonSchema)でJSONを受け取り、
// Claude と同じ zod スキーマで検証する。適合しなければ ReceiptSchemaError を
// 投げ、呼び出し側(convex/receipts.ts)が1回だけ再試行する。

// 既定モデル。Flash系はレシートのOCRに十分な精度がありながら桁違いに安く、
// 無料枠でも試せる(無料枠は入力がGoogleの製品改善に使われる点に注意)。
// 精度優先なら gemini-3.5-flash、コスト優先なら gemini-2.5-flash-lite に
// Convexの環境変数 RECEIPT_AI_MODEL で差し替えられる(TBD-001)。
const DEFAULT_MODEL = "gemini-2.5-flash";

export class GeminiReceiptParser implements ReceiptParser {
  readonly providerName = "gemini";

  async parse(
    imageBase64: string,
    mediaType: ReceiptMediaType,
    options: ReceiptParseOptions,
  ): Promise<ParsedReceipt> {
    // このSDKは環境変数からAPIキーを読まないので明示的に渡す
    const client = new GoogleGenAI({
      apiKey: requireApiKey(process.env.GEMINI_API_KEY, "GEMINI_API_KEY"),
    });

    const response = await client.models.generateContent({
      model: resolveModel("gemini", process.env.RECEIPT_AI_MODEL, DEFAULT_MODEL),
      contents: [
        {
          role: "user",
          parts: [
            { inlineData: { mimeType: mediaType, data: imageBase64 } },
            { text: PROMPT },
          ],
        },
      ],
      config: {
        responseMimeType: "application/json",
        responseJsonSchema: receiptJsonSchema(),
        // 読み取り全体のタイムアウト(要件30秒)から割り当てられた残り時間
        httpOptions: { timeout: options.timeoutMs },
      },
    });

    const text = response.text;
    if (text === undefined || text.trim() === "") {
      // 応答にテキストが無い(安全フィルタ・打ち切りなど)
      throw new ReceiptSchemaError();
    }

    // JSONの構文エラーもスキーマ不適合も同じ扱い(1回だけリトライする)
    const parsed = ReceiptSchema.safeParse(safeJsonParse(text));
    if (!parsed.success) {
      throw new ReceiptSchemaError();
    }
    return parsed.data;
  }
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null; // zod側で不適合として扱う
  }
}
