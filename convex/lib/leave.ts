export type LeaveBlocker = "draft" | "unsettled" | null;

export const LEAVE_BLOCKER_MESSAGE: Record<
  Exclude<LeaveBlocker, null>,
  string
> = {
  draft: "下書きの支出が残っています。確定するか削除してから退出してください",
  unsettled: "未精算の支出があります。先に精算してから退出してください",
};

export function getLeaveBlocker(input: {
  expenses: ReadonlyArray<{ status: "draft" | "confirmed" }>;
  truncated: boolean;
}): LeaveBlocker {
  if (input.expenses.some((expense) => expense.status === "draft")) {
    return "draft";
  }
  if (input.truncated || input.expenses.length > 0) {
    return "unsettled";
  }
  return null;
}
