import { z } from "zod";

// レシート抽出の出力スキーマとプロンプト。プロバイダ間で共有する
// (Claudeは zodOutputFormat、GeminiはJSON Schemaに変換して使う)。
// SDKに依存しないので "use node" は不要。

export const ReceiptSchema = z.object({
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

export const PROMPT = `このレシート画像から購入情報を抽出してください。
- 品目名は略称を可能な範囲で正式名に展開する(例: 「ﾆﾝｼﾞﾝ」→「にんじん」)
- price はその行に印字されている税込金額(円・整数)。1個あたりの単価ではなく行の合計
- quantity はその行の数量(数量の表示がなければ1)
- 値引きはその品目の price に反映する
- total_amount はレシートの合計金額(税込)
- 店名・購入日が判読できなければ null
- レシートでない画像や、判読できない画像のときは items を空配列にする`;

// Gemini の responseJsonSchema 用。zodのスキーマから生成して二重管理を避ける。
// $schema はGeminiがサポートするキーの一覧に無いので落とす。
export function receiptJsonSchema(): Record<string, unknown> {
  const jsonSchema = z.toJSONSchema(ReceiptSchema) as Record<string, unknown>;
  delete jsonSchema.$schema;
  return jsonSchema;
}
