import { expect, test } from "vitest";
import {
  originAfterNameEdit,
  originAfterShareEdit,
  originFromMatched,
  originOrDefault,
  showsHistoryBadge,
} from "./share-origin";

test("欠けた出どころは既定になる", () => {
  expect(originOrDefault(undefined)).toBe("default");
  expect(originOrDefault("history")).toBe("history");
  expect(originOrDefault("default")).toBe("default");
  expect(originOrDefault("user")).toBe("user");
});

test("前回の印は履歴のときだけ出る", () => {
  expect(showsHistoryBadge("history")).toBe(true);
  expect(showsHistoryBadge("default")).toBe(false);
  expect(showsHistoryBadge("user")).toBe(false);
});

test("負担区分を触ると出どころはユーザーになる", () => {
  expect(originAfterShareEdit("history")).toBe("user");
  expect(originAfterShareEdit("default")).toBe("user");
  expect(originAfterShareEdit("user")).toBe("user");
});

test("品目名を変えると履歴の印だけが落ちる", () => {
  expect(originAfterNameEdit("history")).toBe("default");
  expect(originAfterNameEdit("default")).toBe("default");
  expect(originAfterNameEdit("user")).toBe("user");
});

test("履歴に当たった品目だけが出どころ history になる", () => {
  expect(originFromMatched(true)).toBe("history");
  expect(originFromMatched(false)).toBe("default");
});
