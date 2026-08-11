import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { fetchUnsettledBalance } from "../client";
import { buildBalanceSummaryText } from "../format";
import { getClerkUserId, toolErrorFromUnknown, toolSuccess } from "../respond";
import { balanceOutputShape } from "../schemas";

const DESCRIPTION = `世帯の未精算差額(現在の残高)を取得する。引数はなし。

いつ使うか:
- 「いま精算するとどっちがいくら払う?」「今の未精算残高は?」のように、期間を限定しない
  「今この瞬間の差額」を聞かれたときに最初に呼ぶ。
- 「今月の未精算いくら?」のように月を指定した質問には、このツールではなく
  monthly_summary の unsettled_balance(月内純差額)を使うこと。get_unsettled_balance は
  前月以前の未精算も合算した全期間の残高であり、月をまたぐと monthly_summary の値とは
  一致しない場合がある。

返り値(主なフィールド):
- amount / direction: 未精算差額(円)とその方向("self_pays_partner" | "partner_pays_self" | "even")。
  even のとき amount は0で精算不要。
- self / partner: 呼び出しユーザーとパートナーの表示名。パートナーが世帯に未参加の場合は partner: null。
- paid_by_self / paid_by_partner: それぞれの未精算分の支払合計。
- included_expense_count: 集計に含めた支出件数(直近200件が上限)。
- draft_count: 未確定(draft)の支出件数。差額には含まれない。
- truncated: true のとき amount 等は部分集計値(200件超のとき)。確定値として案内しないこと。

次に呼ぶツール:
- 差額の内訳(どの支出が対象か)を知りたい場合は list_expenses を呼ぶ。`;

export function registerGetUnsettledBalanceTool(server: McpServer): void {
  server.registerTool(
    "get_unsettled_balance",
    {
      title: "未精算差額を取得",
      description: DESCRIPTION,
      outputSchema: balanceOutputShape,
      annotations: {
        title: "未精算差額を取得",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (extra) => {
      try {
        const clerkUserId = getClerkUserId(extra);
        const data = await fetchUnsettledBalance(clerkUserId);
        return toolSuccess(buildBalanceSummaryText(data), data);
      } catch (error) {
        return toolErrorFromUnknown(error);
      }
    },
  );
}
