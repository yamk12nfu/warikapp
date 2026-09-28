import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { StoppedFixedCostSummary } from "./fixed-cost-detail-client";

test("停止済み固定費の要約に金額・支払者名・負担区分を表示する", () => {
  const html = renderToStaticMarkup(
    <StoppedFixedCostSummary
      amount={120000}
      payerName="あきこ"
      shareLabel="折半"
    />,
  );

  expect(html).toContain("¥120,000");
  expect(html).toContain("あきこ");
  expect(html).toContain("折半");
});
