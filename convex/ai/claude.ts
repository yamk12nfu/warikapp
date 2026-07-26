"use node";

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { ConvexError } from "convex/values";
import { z } from "zod";
import {
  ReceiptSchemaError,
  type ParsedReceipt,
  type ReceiptMediaType,
  type ReceiptParseOptions,
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
//
// 注: SDK 0.112.3 の型に載っている Model のユニオンには claude-opus-5 が
// 含まれていない(SDKのリリースがモデルより古いだけ)。model は任意の文字列を
// 受け付けるので実行には影響しない。SDKを上げれば型にも載る。
const DEFAULT_MODEL = "claude-opus-5";

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
- price はその行に印字されている税込金額(円・整数)。1個あたりの単価ではなく行の合計
- quantity はその行の数量(数量の表示がなければ1)
- 値引きはその品目の price に反映する
- total_amount はレシートの合計金額(税込)
- 店名・購入日が判読できなければ null
- レシートでない画像や、判読できない画像のときは items を空配列にする`;

// 構造化出力のパース失敗(不正JSON / Zod検証エラー)を見分ける。
// SDKはこれを AnthropicError で投げるので、response.parsed_output が null に
// なるより先に例外になる。スキーマ不適合として1回だけリトライしたいので、
// API側のエラー(APIError系。リトライしない)と区別してから変換する。
//
// ⚠️ SDK 0.112.3 には専用のエラークラスが無く(lib/parser.js は AnthropicError に
// 文言を載せて投げるだけ)、やむなく文言で判定している。**SDKを上げたときは
// ここを確認すること**。文言が変われば要件F-003の「1回リトライ」が静かに
// 効かなくなる(専用クラスが公開されたらそちらでの判定に切り替える)。
function isStructuredOutputFailure(error: unknown): boolean {
  return (
    error instanceof Anthropic.AnthropicError &&
    !(error instanceof Anthropic.APIError) &&
    error.message.includes("Failed to parse structured output")
  );
}

export class ClaudeReceiptParser implements ReceiptParser {
  readonly providerName = "claude";

  // ANTHROPIC_API_KEY は Convex の環境変数から自動で読まれる。
  // 未設定だとコンストラクタが例外を投げるので、生成は parse() の中で行う
  // (プロバイダの選択時点では落とさず、実際に使うときに落とす)。
  //
  // SDKのtimeoutはミリ秒指定。自動リトライは切ってある(既定の2回だと
  // 1リクエストで最大3倍の時間がかかり、渡された残り時間を守れなくなるため)。
  private client(timeoutMs: number): Anthropic {
    return new Anthropic({ maxRetries: 0, timeout: timeoutMs });
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
      // モデルIDの綴り間違い・提供終了は404で返る。汎用の
      // 「読み取りに失敗しました」だと原因にたどり着けないので、
      // 設定を直せる文言にして画面に出す(環境変数を変えるだけで直る)
      if (caught instanceof Anthropic.NotFoundError) {
        throw new ConvexError(
          `AIモデル「${this.modelId()}」が使えません。ConvexのRECEIPT_AI_MODELを確認してください`,
        );
      }
      throw caught;
    }
  }

  private modelId(): string {
    return process.env.RECEIPT_AI_MODEL ?? DEFAULT_MODEL;
  }

  private async request(
    imageBase64: string,
    mediaType: ReceiptMediaType,
    options: ReceiptParseOptions,
  ) {
    return await this.client(options.timeoutMs).messages.parse({
      model: this.modelId(),
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
