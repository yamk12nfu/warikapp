export function expenseTitle(
  storeName: string | undefined,
  firstItemName: string | undefined,
): string {
  return storeName ?? firstItemName ?? "(名称なし)";
}
