"use node";

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import {
  ReceiptSchemaError,
  type ParsedReceipt,
  type ReceiptMediaType,
  type ReceiptParseOptions,
  type ReceiptParser,
} from "./types";
import { PROMPT, ReceiptSchema } from "./schema";
import { requireApiKey, resolveModel } from "./config";

// Claude によるレシート読み取り(F-003)。
// 構造化出力(output_config.format)を使うので、JSONの手パースもリトライ用の
// パーサも要らない。スキーマに適合しなかった場合だけ ReceiptSchemaError を投げ、
// 呼び出し側(convex/receipts.ts)が1回だけ再試行する。

// 既定モデル。計画書の執筆時点では claude-opus-4-8 だったが、現行の最新世代
// (Claude 5系)の Opus に更新した。精度優先の方針は計画書のまま。
// コスト・レイテンシを優先したい場合は Convex の環境変数 RECEIPT_AI_MODEL で
// claude-sonnet-5 / claude-haiku-4-5 に差し替えられる(TBD-001)。
//
// 注: SDK 0.112.3 の型に載っている Model のユニオンには claude-opus-5 が
// 含まれていない(SDKのリリースがモデルより古いだけ)。model は任意の文字列を
// 受け付けるので実行には影響しない。SDKを上げれば型にも載る。
const DEFAULT_MODEL = "claude-opus-5";

// 思考(adaptive thinking)の出力も max_tokens に含まれるため余裕を持たせる。
// 実際の課金は使ったぶんだけなので、大きめでもコストは増えない。
const MAX_TOKENS = 16_000;

// 構造化出力のパース失敗(不正JSON / Zod検証エラー)を見分ける。
// SDKはこれを AnthropicError で投げるので、response.parsed_output が null に
// なるより先に例外になる。スキーマ不適合として1回だけリトライしたいので、
// API側のエラー(APIError系。リトライしない)と区別してから変換する。
function isStructuredOutputFailure(error: unknown): boolean {
  return (
    error instanceof Anthropic.AnthropicError &&
    !(error instanceof Anthropic.APIError) &&
    error.message.includes("Failed to parse structured output")
  );
}

export class ClaudeReceiptParser implements ReceiptParser {
  readonly providerName = "claude";

  // 生成は parse() の中で行う(プロバイダの選択時点では落とさず、実際に
  // 使うときに落とす)。APIキーはSDK任せにせず自分で見て、未設定なら
  // 「何を設定すればよいか」を出す。
  //
  // SDKのtimeoutはミリ秒指定。自動リトライは切ってある(既定の2回だと
  // 1リクエストで最大3倍の時間がかかり、渡された残り時間を守れなくなるため)。
  private client(timeoutMs: number): Anthropic {
    return new Anthropic({
      apiKey: requireApiKey(process.env.ANTHROPIC_API_KEY, "ANTHROPIC_API_KEY"),
      maxRetries: 0,
      timeout: timeoutMs,
    });
  }

  async parse(
    imageBase64: string,
    mediaType: ReceiptMediaType,
    options: ReceiptParseOptions,
  ): Promise<ParsedReceipt> {
    const response = await this.parseOnce(imageBase64, mediaType, options);
    if (response.parsed_output === null) {
      // テキストブロックが返らなかった場合(拒否・max_tokens到達など)
      throw new ReceiptSchemaError();
    }
    return response.parsed_output;
  }

  private async parseOnce(
    imageBase64: string,
    mediaType: ReceiptMediaType,
    options: ReceiptParseOptions,
  ) {
    try {
      return await this.request(imageBase64, mediaType, options);
    } catch (caught) {
      if (isStructuredOutputFailure(caught)) {
        throw new ReceiptSchemaError();
      }
      throw caught;
    }
  }

  private async request(
    imageBase64: string,
    mediaType: ReceiptMediaType,
    options: ReceiptParseOptions,
  ) {
    return await this.client(options.timeoutMs).messages.parse({
      model: resolveModel("claude", process.env.RECEIPT_AI_MODEL, DEFAULT_MODEL),
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
  }
}
