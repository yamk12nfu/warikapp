import { describe, expect, test } from "vitest";
import { parseFilter } from "./home-filter";

describe("parseFilter", () => {
  test("accepts each supported filter", () => {
    expect(parseFilter("unsettled")).toBe("unsettled");
    expect(parseFilter("draft")).toBe("draft");
    expect(parseFilter("all")).toBe("all");
  });

  test("defaults missing and unknown values to unsettled", () => {
    expect(parseFilter(null)).toBe("unsettled");
    expect(parseFilter("unknown")).toBe("unsettled");
  });
});
