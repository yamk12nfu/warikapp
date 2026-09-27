// expenses.save の入力上限。サーバー(convex/expenses.ts)・レシート整形
// (lib/receipt.ts)・入力UI(ExpenseEditor)が同じ値で判定するためここに置く
export const MAX_STORE_NAME_LENGTH = 50;
export const MAX_ITEM_NAME_LENGTH = 50;
export const MAX_PRICE = 9_999_999; // 要件 V-403
export const MAX_QUANTITY = 999; // 総額が非現実的な桁にならないための上限
export const MAX_ITEMS = 100; // 要件 V-402。レシート1枚の想定(数十品目)に対する安全弁
