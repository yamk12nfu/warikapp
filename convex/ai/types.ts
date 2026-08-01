// AIプロバイダ抽象化レイヤーの型(TBD-006)。
// レシート読み取りの実装(Claude / Gemini)はこのインターフェースだけを満たせばよく、
// 呼び出し側(convex/receipts.ts)はどのプロバイダかを知らない。
//
// このファイルは型と純粋な判定だけを置き、SDKには依存しない
// (依存すると Node.js ランタイム必須になり、テストからも読みにくくなる)。

// AIから受け取る抽出結果。フィールド名はAIに渡すJSONスキーマと揃えてある
// (プロンプトとスキーマの対応を追いやすくするため、ここだけ snake_case)。
export type ParsedReceipt = {
  store_name: string | null;
  purchased_at: string | null; // "YYYY-MM-DD"。判読不能ならnull
  total_amount: number; // 税込(レシートの支払額)・円・整数
  items: { name: string; price: number; quantity: number }[];
};

// 画像のMIMEタイプ。クライアントはJPEGに再エンコードして送るが、
// プロバイダが受け付ける範囲を型で示しておく
export type ReceiptMediaType =
  | "image/jpeg"
  | "image/png"
  | "image/gif"
  | "image/webp";

// 1回の呼び出しに許す時間。要件の「タイムアウト30秒」は読み取り全体に対する
// 制限なので、リトライを含めた残り時間を呼び出し側が計算して渡す
export type ReceiptParseOptions = { timeoutMs: number };

export interface ReceiptParser {
  readonly providerName: string;
  parse(
    imageBase64: string,
    mediaType: ReceiptMediaType,
    options: ReceiptParseOptions,
  ): Promise<ParsedReceipt>;
}

// AI応答がスキーマに適合しなかったことを表すエラー。
// 呼び出し側はこれを見て「1回だけ自動リトライ」する(要件 F-003)。
// 通信エラーやタイムアウトはリトライ対象外なので、型で区別できるようにしてある。
export class ReceiptSchemaError extends Error {
  constructor(message = "AI応答がスキーマに適合しませんでした") {
    super(message);
    this.name = "ReceiptSchemaError";
  }
}
