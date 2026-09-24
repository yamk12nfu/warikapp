import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { ReceiptPeekStrip } from "./receipt-peek";

test("覗き見の帯はボタンで、サムネイルはボタン名と二重に読まれない", () => {
  const html = renderToStaticMarkup(
    <ReceiptPeekStrip src="blob:x" onOpen={() => {}} />,
  );

  expect(html).toContain("レシートを確認");
  expect(html).toContain('aria-label="レシート画像を拡大する"');
  expect(html).toContain('src="blob:x"');
  expect(html).toContain("<button");
  expect(html).toContain('type="button"');
  expect(html).toContain("alt=\"\"");
});
