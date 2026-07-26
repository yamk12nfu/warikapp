"use node";

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import {
  ReceiptSchemaError,
  type ParsedReceipt,
  type ReceiptMediaType,
  type ReceiptParser,
} from "./types";

// Claude によるレシート読み取り(F-003)。
// 構造化出力(output_config.format)を使うので、JSONの手パースもリトライ用の
// パーサも要らない。スキーマに適合しなかった場合だけ ReceiptSchemaError を投げ、
// 呼び出し側(convex/receipts.ts)が1回だけ再試行する。

// 既定モデル。計画書の執筆時点では claude-opus-4-8 だったが、現行の最新世代
// (Claude 5系)の Opus に更新した。精度優先の方針は計画書のまま。
// コスト・レイテンシを優先したい場合は Convex の環境変数 RECEIPT_AI_MODEL で
// claude-sonnet-5 / claude-haiku-4-5 に差し替えられる(TBD-001)。
const DEFAULT_MODEL = "claude-opus-5";

// 要件: タイムアウト30秒。SDKのtimeoutはミリ秒指定。
// SDK自身の自動リトライは切ってある(既定の2回だと1リクエストで最大90秒かかり、
// 30秒という要件を満たせなくなるため)。リトライはスキーマ不適合時の1回だけ。
const TIMEOUT_MS = 30_000;

// 思考(adaptive thinking)の出力も max_tokens に含まれるため余裕を持たせる。
// 実際の課金は使ったぶんだけなので、大きめでもコストは増えない。
const MAX_TOKENS = 16_000;

const ReceiptSchema = z.object({
  store_name: z.string().nullable(),
  purchased_at: z.string().nullable(), // YYYY-MM-DD。判読不能ならnull
  total_amount: z.number().int(),
  items: z.array(
    z.object({
      name: z.string(),
      price: z.number().int(), // 税込・円
      quantity: z.number().int(),
    }),
  ),
});

const PROMPT = `このレシート画像から購入情報を抽出してください。
- 品目名は略称を可能な範囲で正式名に展開する(例: 「ﾆﾝｼﾞﾝ」→「にんじん」)
- 価格は税込・円・整数。値引きはその品目の価格に反映する
- quantity は数量(既定は1)。price は1個あたりではなく、その行の税込金額
- total_amount はレシートの合計金額(税込)
- 店名・購入日が判読できなければ null
- レシートでない画像や、判読できない画像のときは items を空配列にする`;

export class ClaudeReceiptParser implements ReceiptParser {
  readonly providerName = "claude";

  // ANTHROPIC_API_KEY は Convex の環境変数から自動で読まれる。
  // 未設定だとコンストラクタが例外を投げるので、生成は parse() の中で行う
  // (プロバイダの選択時点では落とさず、実際に使うときに落とす)。
  private client(): Anthropic {
    return new Anthropic({ maxRetries: 0, timeout: TIMEOUT_MS });
  }

  async parse(
    imageBase64: string,
    mediaType: ReceiptMediaType,
  ): Promise<ParsedReceipt> {
    const response = await this.client().messages.parse({
      model: process.env.RECEIPT_AI_MODEL ?? DEFAULT_MODEL,
      max_tokens: MAX_TOKENS,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: mediaType, data: imageBase64 },
            },
            { type: "text", text: PROMPT },
          ],
        },
      ],
      output_config: {
        // レシートの読み取りは推論より知覚が主なので effort は低くてよい
        // (要件の「通常15秒以内」を満たしやすくする)
        effort: "low",
        format: zodOutputFormat(ReceiptSchema),
      },
    });

    if (response.parsed_output === null) {
      throw new ReceiptSchemaError();
    }
    return response.parsed_output;
  }
}
