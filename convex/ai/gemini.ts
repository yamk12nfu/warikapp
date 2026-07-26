"use node";

import { ApiError, GoogleGenAI } from "@google/genai";
import { ConvexError } from "convex/values";
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

// 既定モデル。この機能がやっているのは「画像から項目を構造化して取り出す」
// =データ抽出なので、生のOCR転写より抽出の精度で選ぶ。
// Roboflow Vision Evals(第三者ベンチ)の抽出スコアは
//   gemini-3.6-flash        94.8%(2位/21) レイテンシ2.5秒
//   gemini-3.5-flash-lite   90.7%(6位/21) レイテンシ1.3秒
// で、月100枚のコスト差は¥20程度。読み取り誤りの手直しの手間を考えると
// 精度側を取る価値がある(レシートの「品目|金額」はテーブル的な読み取りで、
// Flash-Liteは前世代比でテーブルが落ちているという報告もある)。
//
// コスト・速度を優先するなら gemini-3.5-flash-lite / gemini-2.5-flash-lite に
// Convexの環境変数 RECEIPT_AI_MODEL で差し替えられる(TBD-001)。
// ※上記は日本語の感熱紙レシートで測ったものではないので、実レシートで確認すること。
const DEFAULT_MODEL = "gemini-3.6-flash";

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

    const model = resolveModel(
      "gemini",
      process.env.RECEIPT_AI_MODEL,
      DEFAULT_MODEL,
    );
    const request = {
      model,
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
    };

    let response;
    try {
      response = await client.models.generateContent(request);
    } catch (caught) {
      // モデルIDの綴り間違い・提供終了は404で返る。汎用の
      // 「読み取りに失敗しました」だと原因にたどり着けないので、
      // 設定を直せる文言にして画面に出す(環境変数を変えるだけで直る)。
      // モデルIDはSDKの型では縛れない(model は任意の文字列)ので、
      // 間違いは実行時にしか分からない
      if (caught instanceof ApiError && caught.status === 404) {
        throw new ConvexError(
          `AIモデル「${model}」が使えません。ConvexのRECEIPT_AI_MODELを確認してください`,
        );
      }
      throw caught;
    }

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
