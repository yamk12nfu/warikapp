export const CATEGORIES = [
  { id: "food", label: "食費" },
  { id: "daily", label: "日用品" },
  { id: "transport", label: "交通" },
  { id: "housing", label: "住居・光熱" },
  { id: "medical", label: "医療" },
  { id: "leisure", label: "娯楽" },
  { id: "other", label: "その他" },
] as const;

export type StoredCategoryId = (typeof CATEGORIES)[number]["id"];

export type CategoryId = StoredCategoryId | "uncategorized";

// 品目の分類が未設定なら支出の分類を使う。品目では「未分類」を明示的に
// 上書きできない(未設定は常に支出から継承するため)。
export function effectiveItemCategory(
  itemCategory: StoredCategoryId | undefined,
  expenseCategory: CategoryId,
): CategoryId {
  return itemCategory ?? expenseCategory;
}

// 支出の分類と同じ品目分類は保存せず、支出の変更に追従させる。
export function normalizeItemCategory(
  itemCategory: StoredCategoryId | undefined,
  expenseCategory: CategoryId,
): StoredCategoryId | undefined {
  return itemCategory === expenseCategory ? undefined : itemCategory;
}

export const UNCATEGORIZED_LABEL = "未分類";

export const STORED_CATEGORY_IDS: readonly StoredCategoryId[] = CATEGORIES.map(
  (category) => category.id,
);

export function isStoredCategoryId(value: string): value is StoredCategoryId {
  return STORED_CATEGORY_IDS.some((id) => id === value);
}

export function categoryLabel(id: CategoryId): string {
  if (id === "uncategorized") {
    return UNCATEGORIZED_LABEL;
  }
  const category = CATEGORIES.find((row) => row.id === id);
  if (category === undefined) {
    throw new Error(`missing category label: ${id}`);
  }
  return category.label;
}

export function toStoredCategory(id: CategoryId): StoredCategoryId | undefined {
  if (id === "uncategorized") {
    return undefined;
  }
  return id;
}

export function normalizeCategory(raw: string | null | undefined): CategoryId {
  if (raw === null || raw === undefined) {
    return "uncategorized";
  }
  if (isStoredCategoryId(raw)) {
    return raw;
  }
  throw new Error(`unknown category: ${raw}`);
}
