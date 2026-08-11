import { z } from "zod";

// MCPツール4本のinput/output zodスキーマ。
// docs/mcp-server-plan.md §4.3 のレスポンス形と同形(snake_case)にしてあり、
// Convex側(convex/http.ts)のJSONをほぼそのままstructuredContentとして返せるようにする。
//
// registerTool の inputSchema / outputSchema には「raw shape」
// (Record<string, ZodType>)を渡す(SDKのregisterToolはZodRawShapeCompatか
// 完全なZodObjectのどちらも受け付けるが、このリポジトリでは公式ガイドの例に
// 合わせてraw shapeを使う)。z.object(shape) でラップした完全版は
// z.infer で型を取り出すため、および単体テストでの適合チェックのために用意する。

// 未精算差額・月内純差額の方向。from/toのIDだけだとLLMが読み違えるため
// 冗長に持つ(計画書 D6 の隣接決定)。
export const directionEnum = z.enum(["self_pays_partner", "partner_pays_self", "even"]);

export const sourceEnum = z.enum(["receipt", "manual"]);
export const statusEnum = z.enum(["draft", "confirmed"]);

// メンバー参照(自分/相手/支払者/負担者で共通)
export const memberRefSchema = z.object({
  member_id: z.string(),
  display_name: z.string(),
});

// --- get_unsettled_balance -------------------------------------------------

export const balanceOutputShape = {
  currency: z.literal("JPY"),
  amount: z.number().int().min(0).describe("未精算差額(円)。0以上。0のとき精算不要"),
  direction: directionEnum.describe(
    "差額の方向。even のとき amount は0で self/partner のどちらも支払わない",
  ),
  self: memberRefSchema.describe("呼び出しユーザー自身"),
  partner: memberRefSchema
    .nullable()
    .describe("パートナー。世帯にまだ2人目が参加していない場合は null"),
  paid_by_self: z.number().int().describe("自分が支払った未精算分の合計(円)"),
  paid_by_partner: z.number().int().describe("相手が支払った未精算分の合計(円)"),
  included_expense_count: z
    .number()
    .int()
    .describe("差額の集計に含めた支出件数。truncated:true のときは全件数ではない"),
  draft_count: z.number().int().describe("未確定(draft)の支出件数。差額には含まれない"),
  truncated: z
    .boolean()
    .describe("true のとき amount 等は部分集計値(上限200件を超えた場合)。確定値として扱わないこと"),
};
export const balanceOutputSchema = z.object(balanceOutputShape);
export type BalanceResponse = z.infer<typeof balanceOutputSchema>;

// --- list_expenses -----------------------------------------------------------

// YYYY-MM-DD形式かどうかの形式チェックのみ行う(実在日かどうかの検証はConvex側の責務)
const DATE_FORMAT_MESSAGE = "YYYY-MM-DD形式で指定してください(例: 2026-08-01)";
const dateStringSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, DATE_FORMAT_MESSAGE);

export const listExpensesInputShape = {
  filter: z
    .enum(["unsettled", "all"])
    .optional()
    .describe('省略時は"unsettled"(未精算のみ)。"all"で精算済みも含め全件'),
  date_from: dateStringSchema
    .optional()
    .describe(
      "購入日の下限(含む)。JST基準の絶対日付(YYYY-MM-DD)で渡すこと。「先週」等の相対表現は呼び出し側で変換する",
    ),
  date_to: dateStringSchema
    .optional()
    .describe("購入日の上限(含む)。JST基準の絶対日付(YYYY-MM-DD)で渡すこと"),
  cursor: z.string().optional().describe("前回のlist_expensesが返したnext_cursorをそのまま渡す"),
  limit: z
    .number()
    .int()
    .min(1)
    .max(50)
    .optional()
    .describe("1〜50件。省略時は20件"),
};
export const listExpensesInputSchema = z.object(listExpensesInputShape);
export type ListExpensesInput = z.infer<typeof listExpensesInputSchema>;

const expenseListItemSchema = z.object({
  id: z.string(),
  title: z.string().describe("店名 → 先頭品目名 → \"(名称なし)\" の順で決まる表示名"),
  purchased_at: z.string(),
  total_amount: z.number().int(),
  item_count: z.number().int(),
  source: sourceEnum.describe("receipt: レシート読み取り由来 / manual: 手入力"),
  paid_by: memberRefSchema,
  status: statusEnum,
  settled: z.boolean(),
});

export const listExpensesOutputShape = {
  currency: z.literal("JPY"),
  expenses: z.array(expenseListItemSchema),
  returned_count: z
    .number()
    .int()
    .describe("実際に返した件数。通常はlimit件だがページ境界で前後しうる"),
  has_more: z.boolean(),
  next_cursor: z
    .string()
    .nullable()
    .describe("続きがある場合の次ページ用カーソル。最終ページはnull(欠落ではなく明示的null)"),
};
export const listExpensesOutputSchema = z.object(listExpensesOutputShape);
export type ListExpensesResponse = z.infer<typeof listExpensesOutputSchema>;

// --- monthly_summary -----------------------------------------------------------

export const monthlySummaryInputShape = {
  month: z
    .string()
    .regex(/^\d{4}-\d{2}$/, "YYYY-MM形式で指定してください(例: 2026-08)")
    .optional()
    .describe(
      "対象月(YYYY-MM)。省略時はJSTの今月を自動補完する。「先月」等の相対表現は呼び出し側で絶対値に変換する",
    ),
};
export const monthlySummaryInputSchema = z.object(monthlySummaryInputShape);
export type MonthlySummaryInput = z.infer<typeof monthlySummaryInputSchema>;

const summaryMemberSchema = z.object({
  member_id: z.string(),
  display_name: z.string(),
  is_self: z.boolean(),
  paid_amount: z.number().int().describe("その月にこのメンバーが支払った合計(confirmedのみ)"),
  share_amount: z.number().int().describe("その月にこのメンバーが負担すべき合計(confirmedのみ)"),
  unsettled_paid_amount: z.number().int().describe("上記のうち未精算分の支払額"),
});

const unsettledBalanceSchema = z.object({
  amount: z.number().int(),
  direction: directionEnum,
});

export const monthlySummaryOutputShape = {
  currency: z.literal("JPY"),
  month: z.string(),
  included_expense_count: z.number().int(),
  draft_count: z.number().int(),
  total_amount: z.number().int(),
  settled_amount: z.number().int(),
  unsettled_amount: z.number().int(),
  unsettled_balance: unsettledBalanceSchema.describe(
    "その月の未精算(confirmed)支出だけを対象にした「誰が誰にいくら」。" +
      "get_unsettled_balance(全期間の現在残高)とは異なり月をまたぐ未精算は含まない",
  ),
  members: z.array(summaryMemberSchema),
  truncated: z
    .boolean()
    .describe("true のとき上記の金額は部分集計値(該当月の対象支出が上限件数を超えた場合)"),
};
export const monthlySummaryOutputSchema = z.object(monthlySummaryOutputShape);
export type MonthlySummaryResponse = z.infer<typeof monthlySummaryOutputSchema>;

// --- get_item_breakdown -----------------------------------------------------------

export const getItemBreakdownInputShape = {
  expense_id: z.string().min(1).describe("list_expenses が返す各支出の id をそのまま渡す"),
};
export const getItemBreakdownInputSchema = z.object(getItemBreakdownInputShape);
export type GetItemBreakdownInput = z.infer<typeof getItemBreakdownInputSchema>;

const itemShareSchema = z.object({
  member_id: z.string(),
  display_name: z.string(),
  ratio_percent: z.number(),
  amount: z.number().int(),
});

const expenseItemSchema = z.object({
  name: z.string(),
  price: z.number().int(),
  quantity: z.number().int(),
  subtotal: z.number().int(),
  shares: z.array(itemShareSchema),
});

export const getItemBreakdownOutputShape = {
  currency: z.literal("JPY"),
  id: z.string(),
  store_name: z.string().nullable().describe("未設定の支出ではnull(欠落ではなく明示的null)"),
  purchased_at: z.string(),
  total_amount: z.number().int(),
  status: statusEnum,
  settled: z.boolean(),
  source: sourceEnum,
  paid_by: memberRefSchema,
  advance_amount: z.number().int().describe("支払者が相手の分を立て替えた金額"),
  items: z.array(expenseItemSchema),
};
export const getItemBreakdownOutputSchema = z.object(getItemBreakdownOutputShape);
export type ExpenseBreakdownResponse = z.infer<typeof getItemBreakdownOutputSchema>;
