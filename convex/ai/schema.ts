import { z } from "zod";

// レシート抽出の出力スキーマとプロンプト。プロバイダ間で共有する
// (Claudeは zodOutputFormat、GeminiはJSON Schemaに変換して使う)。
// SDKに依存しないので "use node" は不要。

// 各フィールドの説明は .describe() で持たせる。コメントと違って
// JSON Schema の description になり、AIにも渡る(Claudeの構造化出力・
// GeminiのresponseJsonSchemaの両方に載る)。
// ここを書き忘れると、たとえば購入日が「2026年7月21日」の形で返ってきて
// 静かに捨てられる(=当日にフォールバックする)。
export const ReceiptSchema = z.object({
  store_name: z.string().nullable().describe("店名。判読できなければ null"),
  purchased_at: z
    .string()
    .nullable()
    .describe('購入日。"YYYY-MM-DD" 形式(例: "2026-07-21")。判読できなければ null'),
  total_amount: z.number().int().describe("レシートの合計金額(税込・円・整数)"),
  items: z.array(
    z.object({
      name: z
        .string()
        .describe("品目名。数量は含めない(数量は quantity に入れる)"),
      price: z
        .number()
        .int()
        .describe("その行の税込金額(円・整数)。1個あたりの単価ではない"),
      quantity: z.number().int().describe("その行の数量。表示がなければ1"),
    }),
  ),
});

export const PROMPT = `このレシート画像から購入情報を抽出してください。
- 品目名は略称を可能な範囲で正式名に展開する(例: 「ﾆﾝｼﾞﾝ」→「にんじん」)
- price はその行に印字されている税込金額(円・整数)。1個あたりの単価ではなく行の合計
- quantity はその行の数量(数量の表示がなければ1)。数量は name に含めない(例:「牛乳 x2」→ name は「牛乳」、quantity は 2)
- 値引きはその品目の price に反映する
- total_amount はレシートの合計金額(税込)
- purchased_at は "YYYY-MM-DD" 形式で返す(例: 「2026年7月21日」→ "2026-07-21")
- 店名・購入日が判読できなければ null
- レシートでない画像や、判読できない画像のときは items を空配列にする`;

// Gemini の responseJsonSchema 用。zodのスキーマから生成して二重管理を避ける。
// $schema はGeminiがサポートするキーの一覧に無いので落とす。
export function receiptJsonSchema(): Record<string, unknown> {
  const jsonSchema = z.toJSONSchema(ReceiptSchema) as Record<string, unknown>;
  delete jsonSchema.$schema;
  return jsonSchema;
}
