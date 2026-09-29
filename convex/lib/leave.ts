export type LeaveBlocker = "draft" | "unsettled" | "pending" | null;

export const LEAVE_BLOCKER_MESSAGE: Record<
  Exclude<LeaveBlocker, null>,
  string
> = {
  pending: "確認待ちの精算があります。確認するか差し戻してから退出してください",
  draft: "下書きの支出が残っています。確定するか削除してから退出してください",
  unsettled: "未精算の支出があります。先に精算してから退出してください",
};

export function getLeaveBlocker(input: {
  hasDraft: boolean;
  hasUnsettled: boolean;
  hasPending: boolean;
}): LeaveBlocker {
  if (input.hasPending) {
    return "pending";
  }
  if (input.hasDraft) {
    return "draft";
  }
  return input.hasUnsettled ? "unsettled" : null;
}
