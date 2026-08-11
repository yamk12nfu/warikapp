import type {
  BalanceResponse,
  ExpenseBreakdownResponse,
  ListExpensesResponse,
  MonthlySummaryResponse,
} from "./schemas";

// MCPツールのテキスト応答(TextContent)を作るための書式・サマリー生成ユーティリティ。
// MCP非依存(SDKの型に依存しない)。structuredContentの組み立ては respond.ts が担う。

const YEN_FORMATTER = new Intl.NumberFormat("ja-JP");

// 円表記(例: 3,210円)。画面表示用の lib/format.ts の formatYen(¥3,210形式)とは
// 用途が異なるため別実装にしてある(MCPのテキストはLLMが読む前提の文体)
export function formatYenText(amount: number): string {
  return `${YEN_FORMATTER.format(amount)}円`;
}

// truncated時の警告文。reasonには「未精算が200件を超えているため部分集計」等、
// 何が上限に達したかを渡す(計画書 §4.3(1)(3))。モデルが確定値として案内しないよう、
// 「⚠️」と「確定値として答えないこと」を必ず含める
export function truncatedWarningText(reason: string): string {
  return `⚠️ ${reason}のため部分集計です。確定値として答えないこと。`;
}

// TextContent本文の文字数上限。超過時はJSONを機械的に切らず(不正JSONになるため)、
// 有効な要約テキストに丸ごと置き換える(計画書 §5.3)
export const TEXT_CHARACTER_LIMIT = 25000;

// summaryText と structuredContent の JSON を連結してTextContent本文を作る。
// 上限を超える場合はJSONを含めず、structuredContent参照を促す注記に置き換える
export function buildTextContent(summaryText: string, structuredContent: unknown): string {
  const json = JSON.stringify(structuredContent, null, 2);
  const full = `${summaryText}\n\n\`\`\`json\n${json}\n\`\`\``;
  if (full.length <= TEXT_CHARACTER_LIMIT) {
    return full;
  }
  return (
    `${summaryText}\n\n` +
    `(この応答は${full.length}文字あり上限(${TEXT_CHARACTER_LIMIT}文字)を超えるため、` +
    "詳細JSONの本文は省略しました。テキストは省略済みです。完全なデータは structuredContent を参照してください。)"
  );
}

function directionLabel(direction: "self_pays_partner" | "partner_pays_self" | "even"): string {
  switch (direction) {
    case "self_pays_partner":
      return "自分が相手に支払う方向";
    case "partner_pays_self":
      return "相手が自分に支払う方向";
    case "even":
      return "精算不要";
  }
}

// get_unsettled_balance の応答テキスト
export function buildBalanceSummaryText(data: BalanceResponse): string {
  const lines: string[] = [];
  if (data.truncated) {
    lines.push(truncatedWarningText("未精算の支出が200件を超えている"));
  }
  if (data.direction === "even" || data.partner === null) {
    lines.push("未精算差額はありません(精算不要です)。");
  } else {
    const fromName =
      data.direction === "partner_pays_self" ? data.partner.display_name : data.self.display_name;
    const toName =
      data.direction === "partner_pays_self" ? data.self.display_name : data.partner.display_name;
    lines.push(
      `未精算差額: ${fromName}が${toName}に${formatYenText(data.amount)}支払うと精算できます(${directionLabel(data.direction)})。`,
    );
  }
  lines.push(
    `内訳: 自分の支払い ${formatYenText(data.paid_by_self)} / 相手の支払い ${formatYenText(data.paid_by_partner)} / 対象件数 ${data.included_expense_count}件`,
  );
  if (data.draft_count > 0) {
    lines.push(`未確定(draft)のレシートが${data.draft_count}件あります。これらは差額に含まれていません。`);
  }
  return lines.join("\n");
}

// list_expenses の応答テキスト
export function buildExpenseListSummaryText(data: ListExpensesResponse): string {
  const lines: string[] = [`支出一覧: ${data.returned_count}件を表示。`];
  for (const expense of data.expenses) {
    const statusLabel = expense.status === "draft" ? "未確定" : "確定";
    const settledLabel = expense.settled ? "精算済み" : "未精算";
    lines.push(
      `- ${expense.purchased_at} ${expense.title} ${formatYenText(expense.total_amount)}` +
        `(支払: ${expense.paid_by.display_name} / ${statusLabel} / ${settledLabel} / id: ${expense.id})`,
    );
  }
  if (data.has_more && data.next_cursor !== null) {
    lines.push(
      `続きがあります。次のページを見るには list_expenses の cursor に "${data.next_cursor}" を渡してください。`,
    );
  }
  return lines.join("\n");
}

// monthly_summary の応答テキスト
export function buildMonthlySummaryText(data: MonthlySummaryResponse): string {
  const lines: string[] = [];
  if (data.truncated) {
    lines.push(truncatedWarningText(`${data.month}の対象支出が200件を超えている`));
  }
  lines.push(
    `${data.month}の合計: ${formatYenText(data.total_amount)}(対象${data.included_expense_count}件、うち未確定${data.draft_count}件)`,
  );
  lines.push(`精算済み ${formatYenText(data.settled_amount)} / 未精算 ${formatYenText(data.unsettled_amount)}`);
  const ub = data.unsettled_balance;
  if (ub.direction === "even") {
    lines.push(`${data.month}内の未精算差額(unsettled_balance)はありません。`);
  } else {
    lines.push(
      `${data.month}内の未精算差額(unsettled_balance): ${formatYenText(ub.amount)}(${directionLabel(ub.direction)})`,
    );
  }
  lines.push(
    "※ unsettled_balanceはこの月の支出だけを対象にした差額です。前月以前の未精算も合算した" +
      "「いま精算するといくら」を知りたい場合は get_unsettled_balance を使ってください。",
  );
  for (const member of data.members) {
    lines.push(
      `- ${member.display_name}${member.is_self ? "(自分)" : ""}: ` +
        `支払${formatYenText(member.paid_amount)} / 負担${formatYenText(member.share_amount)} / ` +
        `未精算分の支払${formatYenText(member.unsettled_paid_amount)}`,
    );
  }
  return lines.join("\n");
}

// get_item_breakdown の応答テキスト
export function buildItemBreakdownSummaryText(data: ExpenseBreakdownResponse): string {
  const title = data.store_name ?? "(店名なし)";
  const lines: string[] = [
    `${title}(${data.purchased_at}) 合計 ${formatYenText(data.total_amount)} / ` +
      `支払: ${data.paid_by.display_name} / ${data.settled ? "精算済み" : "未精算"}`,
  ];
  for (const item of data.items) {
    const shareText = item.shares
      .map((share) => `${share.display_name} ${share.ratio_percent}%(${formatYenText(share.amount)})`)
      .join(", ");
    lines.push(
      `- ${item.name} ${formatYenText(item.price)} × ${item.quantity} = ${formatYenText(item.subtotal)}` +
        `(負担: ${shareText})`,
    );
  }
  return lines.join("\n");
}
