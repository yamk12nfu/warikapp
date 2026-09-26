// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import ExpenseEditor from "./ExpenseEditor";

afterEach(() => {
  cleanup();
});

it("チップを押すと負担区分が折半・自分・相手の順に循環する", () => {
  const self = { _id: "self", displayName: "あなた" };
  const partner = { _id: "partner", displayName: "相手" };

  render(
    <ExpenseEditor
      self={self}
      partner={partner}
      initialValue={{
        paidBy: self._id,
        storeName: "",
        purchasedAt: "2026-09-23",
        category: "uncategorized",
        items: [
          {
            name: "牛乳",
            price: 200,
            quantity: 1,
            shares: [
              { memberId: self._id, ratioPercent: 50 },
              { memberId: partner._id, ratioPercent: 50 },
            ],
          },
        ],
      }}
      submitLabel="確定"
      submittingLabel="確定中"
      onSubmit={async () => {}}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: "負担区分: 折半" }));
  expect(screen.getByRole("button", { name: "負担区分: 自分" })).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: "負担区分: 自分" }));
  expect(screen.getByRole("button", { name: "負担区分: 相手" })).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: "負担区分: 相手" }));
  expect(screen.getByRole("button", { name: "負担区分: 折半" })).toBeTruthy();
});
