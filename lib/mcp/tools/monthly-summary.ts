import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { todayInJst } from "../../date";
import { fetchMonthlySummary } from "../client";
import { buildMonthlySummaryText } from "../format";
import { getClerkUserId, toolErrorFromUnknown, toolSuccess } from "../respond";
import { monthlySummaryInputShape, monthlySummaryOutputShape } from "../schemas";

const DESCRIPTION = `指定した月の支出サマリー(合計・メンバー別の支払/負担・精算状況)を取得する。

いつ使うか:
- 「今月の合計は?」「8月の食費は精算するといくらになる?」のように、月単位の集計を
  聞かれたとき。
- 「今月の未精算いくら?」には、このツールが返す unsettled_balance(月内純差額)で
  答えること。get_unsettled_balance(全期間の現在残高)は前月以前の未精算も合算されるため、
  月だけを指定した質問への回答としては不正確になりうる(両者の使い分けはここが基準)。

引数:
- month?: "YYYY-MM" 形式。省略時はJSTの今月を自動補完する。「先月」等の相対表現を
  渡したい場合は、呼び出し側(モデル)でJST基準の絶対値に変換してから渡すこと。

返り値:
- total_amount / settled_amount / unsettled_amount: 月内の確定(confirmed)支出の金額集計
  (draftは件数のみで金額には含まれない)。
- unsettled_balance: 月内の未精算(confirmed)支出だけを対象にした「誰が誰にいくら」
  (amount, direction)。get_unsettled_balance との違いは説明のとおり。
- members: メンバーごとの paid_amount(支払合計) / share_amount(負担合計) /
  unsettled_paid_amount(未精算分の支払額)。
- truncated: true のとき上記は部分集計値(該当月の対象支出が上限200件を超えた場合)。

次に呼ぶツール:
- 該当月の支出を一件ずつ見たい場合は、list_expenses に date_from/date_to
  (その月の1日〜末日)を渡して呼ぶ。`;

export function registerMonthlySummaryTool(server: McpServer): void {
  server.registerTool(
    "monthly_summary",
    {
      title: "月次サマリーを取得",
      description: DESCRIPTION,
      inputSchema: monthlySummaryInputShape,
      outputSchema: monthlySummaryOutputShape,
      annotations: {
        title: "月次サマリーを取得",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (args, extra) => {
      try {
        const clerkUserId = getClerkUserId(extra);
        // month省略時はNext.js側でJSTの今月を補完する(Convex queryはwall clockを
        // 読まない既存規約のため、summary API自体はmonth必須。計画書 §4.3(3))
        const month = args.month ?? todayInJst().slice(0, 7);
        const data = await fetchMonthlySummary(month, clerkUserId);
        return toolSuccess(buildMonthlySummaryText(data), data);
      } catch (error) {
        return toolErrorFromUnknown(error);
      }
    },
  );
}
