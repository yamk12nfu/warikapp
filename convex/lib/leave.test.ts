import { describe, expect, test } from "vitest";
import { getLeaveBlocker } from "./leave";

describe("getLeaveBlocker", () => {
  test("pending は draft より優先", () => {
    expect(
      getLeaveBlocker({
        hasDraft: true,
        hasUnsettled: true,
        hasPending: true,
      }),
    ).toBe("pending");
  });

  test("pending が無ければ従来の順", () => {
    expect(
      getLeaveBlocker({
        hasDraft: true,
        hasUnsettled: true,
        hasPending: false,
      }),
    ).toBe("draft");
  });
});
