export type Filter = "unsettled" | "draft" | "all";

export const FILTER_LABEL: Record<Filter, string> = {
  unsettled: "未精算のみ",
  draft: "未確定のみ",
  all: "すべて",
};

export const FILTER_EMPTY_STATE: Record<Filter, string> = {
  unsettled: "未精算の支出はまだありません",
  draft: "未確定の支出はありません",
  all: "支出はまだありません",
};

export function parseFilter(raw: string | null): Filter {
  if (raw === "draft" || raw === "all") {
    return raw;
  }
  return "unsettled";
}
