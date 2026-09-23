import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import ExpenseEditor from "./ExpenseEditor";
import type { InitialShareOrigin } from "@/lib/share-origin";

const self = { _id: "self", displayName: "あなた" };
const partner = { _id: "partner", displayName: "相手" };

function renderEditor(origins?: readonly InitialShareOrigin[]) {
  return renderToStaticMarkup(
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
      initialShareOrigins={origins}
      submitLabel="確定"
      submittingLabel="確定中"
      onSubmit={async () => {}}
    />,
  );
}

test("履歴に当たった折半は前回と出る", () => {
  const html = renderEditor(["history"]);
  expect(html).toContain('aria-label="負担区分: 折半（前回）"');
  expect(html).toContain("前回");
});

test("履歴に当たらない折半は前回と出ない", () => {
  expect(renderEditor(["default"])).not.toContain("前回");
  expect(renderEditor(undefined)).not.toContain("前回");
});
