"use node";

import { ConvexError } from "convex/values";
import type { ParsedReceipt, ReceiptParser } from "./types";

// Gemini 実装の置き場(TBD-006)。MVPではClaudeのみを実装し、ここは
// 「未実装」を投げるだけにしてある。プロバイダを増やすときに
// convex/ai/index.ts の分岐とこのファイルを埋めれば、呼び出し側は変更不要。

export class GeminiReceiptParser implements ReceiptParser {
  readonly providerName = "gemini";

  // 引数はインターフェースどおり受け取れるが、使わないので省略している
  // (引数の少ない関数は多い関数の代わりに使える)
  async parse(): Promise<ParsedReceipt> {
    // 画面に文言を出すため ConvexError(素の Error は本番でクライアントに届かない)
    throw new ConvexError("Geminiでの読み取りはまだ利用できません");
  }
}
