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
