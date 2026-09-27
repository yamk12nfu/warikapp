// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import ExpenseEditor from "./ExpenseEditor";
import type { EditorMember, ExpenseFormValue } from "./ExpenseEditor";

const self: EditorMember = { _id: "self", displayName: "あなた" };
const partner: EditorMember = { _id: "partner", displayName: "相手" };
const itemNames = ["牛乳", "パン", "米"];

function makeInitialValue(): ExpenseFormValue {
  return {
    paidBy: self._id,
    storeName: "",
    purchasedAt: "2026-09-23",
    category: "uncategorized",
    items: itemNames.map((name, index) => ({
      name,
      price: (index + 1) * 100,
      quantity: 1,
      shares: [
        { memberId: self._id, ratioPercent: 50 },
        { memberId: partner._id, ratioPercent: 50 },
      ],
    })),
  };
}

function renderEditor({
  selectedPartner = partner,
  initialShareOrigins,
  onSubmit = async () => {},
}: {
  selectedPartner?: EditorMember | null;
  initialShareOrigins?: readonly ("history" | "default")[];
  onSubmit?: (value: ExpenseFormValue) => Promise<void>;
} = {}) {
  return render(
    <ExpenseEditor
      self={self}
      partner={selectedPartner}
      initialValue={makeInitialValue()}
      initialShareOrigins={initialShareOrigins}
      submitLabel="確定"
      submittingLabel="確定中"
      onSubmit={onSubmit}
    />,
  );
}

afterEach(() => {
  cleanup();
});

it("チップを押すと負担区分が折半・自分・相手の順に循環する", () => {
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

it("一括ボタンで全品目の負担区分を変更し前回表示を消す", () => {
  renderEditor({ initialShareOrigins: ["default", "history", "default"] });

  expect(
    screen.getByRole("button", { name: "負担区分: 折半（前回）" }),
  ).toBeTruthy();
  fireEvent.click(
    screen.getAllByRole("button", { name: "カスタム割合を入力" })[0]!,
  );
  expect(screen.getByRole("textbox", { name: "あなた %" })).toBeTruthy();
  expect(
    screen.getByRole("group", { name: "負担区分をまとめて変更" }),
  ).toBeTruthy();
  for (const label of ["すべて折半", "すべて自分", "すべて相手"]) {
    expect(
      screen.getByRole("button", { name: label }).hasAttribute("aria-pressed"),
    ).toBe(false);
  }

  fireEvent.click(screen.getByRole("button", { name: "すべて自分" }));
  expect(
    screen.getAllByRole("button", { name: "負担区分: 自分" }),
  ).toHaveLength(3);
  expect(screen.queryByRole("textbox", { name: "あなた %" })).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: "すべて相手" }));
  expect(
    screen.getAllByRole("button", { name: "負担区分: 相手" }),
  ).toHaveLength(3);

  fireEvent.click(screen.getByRole("button", { name: "すべて折半" }));
  expect(
    screen.getAllByRole("button", { name: "負担区分: 折半" }),
  ).toHaveLength(3);
});

it("パートナーがいない場合は一括負担区分ボタンを表示しない", () => {
  renderEditor({ selectedPartner: null });

  expect(
    screen.queryByRole("group", { name: "負担区分をまとめて変更" }),
  ).toBeNull();
});

it("一括で自分にした負担割合を送信する", async () => {
  const onSubmit = vi.fn<(value: ExpenseFormValue) => Promise<void>>(
    async () => {},
  );
  renderEditor({ onSubmit });

  fireEvent.click(screen.getByRole("button", { name: "すべて自分" }));
  fireEvent.click(screen.getByRole("button", { name: "確定" }));

  await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
  expect(onSubmit).toHaveBeenCalledWith(
    expect.objectContaining({
      items: itemNames.map((name, index) => ({
        name,
        price: (index + 1) * 100,
        quantity: 1,
        shares: [{ memberId: self._id, ratioPercent: 100 }],
      })),
    }),
  );
});

it("品目分類を上書きするとその品目だけチップ表示され送信される", async () => {
  const onSubmit = vi.fn<(value: ExpenseFormValue) => Promise<void>>(
    async () => {},
  );
  const initialValue = makeInitialValue();
  initialValue.category = "daily";
  render(
    <ExpenseEditor
      self={self}
      partner={partner}
      initialValue={initialValue}
      submitLabel="確定"
      submittingLabel="確定中"
      onSubmit={onSubmit}
    />,
  );

  const inheritedControls = screen.getAllByRole("combobox", {
    name: "品目の分類: 支出と同じ",
  });
  fireEvent.change(inheritedControls[0]!, { target: { value: "food" } });

  const foodChip = screen.getByRole("combobox", {
    name: "品目の分類: 食費",
  }) as HTMLSelectElement;
  expect(foodChip.value).toBe("food");
  expect(foodChip.className).toContain("bg-me-soft");
  expect(
    screen.getAllByRole("combobox", {
      name: "品目の分類: 支出と同じ",
    }),
  ).toHaveLength(2);

  fireEvent.click(screen.getByRole("button", { name: "確定" }));
  await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
  expect(onSubmit.mock.calls[0]![0].items.map((item) => item.category)).toEqual([
    "food",
    undefined,
    undefined,
  ]);
});

it("品目分類で支出と同じを選ぶと上書きを外して送信する", async () => {
  const onSubmit = vi.fn<(value: ExpenseFormValue) => Promise<void>>(
    async () => {},
  );
  const initialValue = makeInitialValue();
  initialValue.category = "daily";
  render(
    <ExpenseEditor
      self={self}
      partner={partner}
      initialValue={initialValue}
      submitLabel="確定"
      submittingLabel="確定中"
      onSubmit={onSubmit}
    />,
  );

  fireEvent.change(
    screen.getAllByRole("combobox", {
      name: "品目の分類: 支出と同じ",
    })[0]!,
    { target: { value: "food" } },
  );
  fireEvent.change(
    screen.getByRole("combobox", { name: "品目の分類: 食費" }),
    { target: { value: "same" } },
  );

  expect(
    screen.queryByRole("combobox", { name: "品目の分類: 食費" }),
  ).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "確定" }));
  await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
  expect(onSubmit.mock.calls[0]![0].items.map((item) => item.category)).toEqual([
    undefined,
    undefined,
    undefined,
  ]);
});

it("品目分類で支出自身の分類を選ぶと上書きを外す", () => {
  const initialValue = makeInitialValue();
  initialValue.category = "daily";
  render(
    <ExpenseEditor
      self={self}
      partner={partner}
      initialValue={initialValue}
      submitLabel="確定"
      submittingLabel="確定中"
      onSubmit={async () => {}}
    />,
  );

  fireEvent.change(
    screen.getAllByRole("combobox", {
      name: "品目の分類: 支出と同じ",
    })[0]!,
    { target: { value: "food" } },
  );
  fireEvent.change(
    screen.getByRole("combobox", { name: "品目の分類: 食費" }),
    { target: { value: "daily" } },
  );

  expect(
    screen.queryByRole("combobox", { name: "品目の分類: 食費" }),
  ).toBeNull();
  expect(
    screen.getAllByRole("combobox", {
      name: "品目の分類: 支出と同じ",
    }),
  ).toHaveLength(3);
});

it("支出の分類を品目の上書きと同じ値にすると、その上書きは消えて以後は支出に追従する", () => {
  const initialValue = makeInitialValue();
  initialValue.category = "daily";
  render(
    <ExpenseEditor
      self={self}
      partner={partner}
      initialValue={initialValue}
      submitLabel="確定"
      submittingLabel="確定中"
      onSubmit={async () => {}}
    />,
  );

  fireEvent.change(
    screen.getAllByRole("combobox", { name: "品目の分類: 支出と同じ" })[0]!,
    { target: { value: "food" } },
  );
  const expenseCategory = screen.getByLabelText("分類");
  fireEvent.change(expenseCategory, { target: { value: "food" } });
  fireEvent.change(expenseCategory, { target: { value: "other" } });

  expect(
    screen.queryByRole("combobox", { name: "品目の分類: 食費" }),
  ).toBeNull();
  expect(
    screen.getAllByRole("combobox", { name: "品目の分類: 支出と同じ" }),
  ).toHaveLength(3);
});
