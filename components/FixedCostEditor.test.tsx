import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import FixedCostEditor from "./FixedCostEditor";

const self = { _id: "member-self", displayName: "あきこ" };
const partner = { _id: "member-partner", displayName: "ぼぶ" };
const initialValue = {
  name: "家賃",
  amount: 120000,
  paidBy: self._id,
  shares: [
    { memberId: self._id, ratioPercent: 50 },
    { memberId: partner._id, ratioPercent: 50 },
  ],
  category: "housing" as const,
};

test("作成フォームの入力ID・ラベルと開始月の選択肢を表示する", () => {
  const html = renderToStaticMarkup(
    <FixedCostEditor
      self={self}
      partner={partner}
      mode="create"
      onSubmit={async () => {}}
    />,
  );

  expect(html).toContain('id="fixed-cost-name"');
  expect(html).toContain('aria-label="名目"');
  expect(html).toContain('id="fixed-cost-amount"');
  expect(html).toContain('id="fixed-cost-paid-by"');
  expect(html).toContain('id="fixed-cost-category"');
  expect(html).toContain("今月分から");
  expect(html).toContain("来月分から");
  expect(html).toContain("この固定費を登録する");
});

test("編集フォームは開始月を変更せず、保存ボタンを表示する", () => {
  const html = renderToStaticMarkup(
    <FixedCostEditor
      self={self}
      partner={partner}
      initialValue={initialValue}
      mode="edit"
      onSubmit={async () => {}}
    />,
  );

  expect(html).toContain("変更を保存する");
  expect(html).not.toContain("今月分から");
  expect(html).not.toContain("来月分から");
});
