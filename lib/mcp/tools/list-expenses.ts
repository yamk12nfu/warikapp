import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { fetchExpenseList } from "../client";
import { buildExpenseListSummaryText } from "../format";
import { getClerkUserId, toolErrorFromUnknown, toolSuccess } from "../respond";
import { listExpensesInputShape, listExpensesOutputShape } from "../schemas";

const DESCRIPTION = `支出(レシート読み取り・手入力の両方)の一覧を取得する。

いつ使うか:
- 「先週何買った?」「8月の支出一覧」のように、期間や条件を指定して支出を列挙したいとき。
- 一覧の続きを見るときは、直前の応答が返した next_cursor をそのまま cursor に渡す。

引数:
- filter?: "unsettled"(省略時の既定。未精算のみ) | "all"(精算済みも含め全件)。
- date_from? / date_to?: 購入日の範囲(両端を含む)。"YYYY-MM-DD" 形式の
  JST基準の絶対日付で渡すこと。「先週」「今月」のような相対表現は、このツールを呼ぶ前に
  呼び出し側(モデル)でJST基準の絶対日付に変換すること(Next.js側では変換しない)。
- cursor?: 前回の list_expenses が返した next_cursor。
- limit?: 1〜50件(省略時20件)。

返り値:
- expenses: 各支出の id / title(表示名) / purchased_at / total_amount / item_count /
  source("receipt"=レシート読み取り | "manual"=手入力) / paid_by / status("draft"|"confirmed") / settled。
- returned_count: 実際に返した件数(通常はlimit件だがページ境界で前後しうる)。
- has_more / next_cursor: 続きがあるかどうかと次ページ用カーソル(最終ページは next_cursor: null)。

次に呼ぶツール:
- 特定の支出の品目まで見たい場合は、一覧中の id を渡して get_item_breakdown を呼ぶ。`;

export function registerListExpensesTool(server: McpServer): void {
  server.registerTool(
    "list_expenses",
    {
      title: "支出一覧を取得",
      description: DESCRIPTION,
      inputSchema: listExpensesInputShape,
      outputSchema: listExpensesOutputShape,
      annotations: {
        title: "支出一覧を取得",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (args, extra) => {
      try {
        const clerkUserId = getClerkUserId(extra);
        const data = await fetchExpenseList(args, clerkUserId);
        return toolSuccess(buildExpenseListSummaryText(data), data);
      } catch (error) {
        return toolErrorFromUnknown(error);
      }
    },
  );
}
