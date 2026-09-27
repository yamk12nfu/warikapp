import { STORED_CATEGORY_IDS, type StoredCategoryId } from "./category";

export type BudgetRow = {
  month: string;
  category?: StoredCategoryId;
  amount: number;
};

export type BudgetMap = {
  overall: number | null;
  categories: Partial<Record<StoredCategoryId, number>>;
};

export function resolveBudgets(
  rows: readonly BudgetRow[],
  month: string,
): BudgetMap {
  let overall: { month: string; amount: number } | undefined;
  const categories: Partial<
    Record<StoredCategoryId, { month: string; amount: number }>
  > = {};

  for (const row of rows) {
    if (row.month > month) {
      continue;
    }
    if (row.category === undefined) {
      if (overall === undefined || row.month > overall.month) {
        overall = { month: row.month, amount: row.amount };
      }
      continue;
    }
    const current = categories[row.category];
    if (current === undefined || row.month > current.month) {
      categories[row.category] = { month: row.month, amount: row.amount };
    }
  }

  const resolvedCategories: Partial<Record<StoredCategoryId, number>> = {};
  for (const category of STORED_CATEGORY_IDS) {
    const row = categories[category];
    if (row === undefined) {
      continue;
    }
    if (row.amount > 0) {
      resolvedCategories[category] = row.amount;
    }
  }

  return {
    overall: overall !== undefined && overall.amount > 0 ? overall.amount : null,
    categories: resolvedCategories,
  };
}

export function budgetRatio(spent: number, budget: number): number {
  return budget <= 0 ? 0 : spent / budget;
}
