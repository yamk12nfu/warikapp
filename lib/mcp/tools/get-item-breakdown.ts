import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { fetchExpenseBreakdown } from "../client";
import { buildItemBreakdownSummaryText } from "../format";
import { getClerkUserId, toolErrorFromUnknown, toolSuccess } from "../respond";
import { getItemBreakdownInputShape, getItemBreakdownOutputShape } from "../schemas";

const DESCRIPTION = `1件の支出の品目・数量・金額・メンバーごとの負担割合の内訳を取得する。

いつ使うか:
- 「このレシートの中身見せて」「◯◯で買ったものの内訳は?」のように、list_expenses や
  monthly_summary で一覧・言及した特定の支出1件について、品目レベルの明細を聞かれたとき。

引数:
- expense_id: list_expenses が返す各支出の id をそのまま渡す。

返り値:
- store_name(未設定の支出はnull) / purchased_at / total_amount / status("draft"|"confirmed") /
  settled / source("receipt"|"manual") / paid_by / advance_amount(支払者が相手の分を
  立て替えた金額)。
- items: 各品目の name / price / quantity / subtotal / shares(メンバーごとの
  ratio_percent と負担金額 amount)。

エラー時の扱い:
- 存在しないID・他世帯のID・削除済みの支出はいずれも404として返る(存在を漏らさないため)。
  list_expenses で有効なIDを確認してから再試行すること。`;

export function registerGetItemBreakdownTool(server: McpServer): void {
  server.registerTool(
    "get_item_breakdown",
    {
      title: "支出の品目内訳を取得",
      description: DESCRIPTION,
      inputSchema: getItemBreakdownInputShape,
      outputSchema: getItemBreakdownOutputShape,
      annotations: {
        title: "支出の品目内訳を取得",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (args, extra) => {
      try {
        const clerkUserId = getClerkUserId(extra);
        const data = await fetchExpenseBreakdown(args.expense_id, clerkUserId);
        return toolSuccess(buildItemBreakdownSummaryText(data), data);
      } catch (error) {
        return toolErrorFromUnknown(error);
      }
    },
  );
}
