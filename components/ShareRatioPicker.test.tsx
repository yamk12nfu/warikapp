import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import ShareRatioPicker, {
  nextPresetShares,
  ShareRatioInputs,
} from "./ShareRatioPicker";
import type { ShareRatio } from "@/lib/types";

const self = { _id: "self", displayName: "あなた" };
const partner = { _id: "partner", displayName: "パートナー" };

function renderPicker(shares: ShareRatio[], custom = false, suggested = false) {
  return renderToStaticMarkup(
    <>
      <ShareRatioPicker
        self={self}
        partner={partner}
        shares={shares}
        custom={custom}
        suggested={suggested}
        onSharesChange={() => {}}
        onCustomChange={() => {}}
      />
      {custom && (
        <ShareRatioInputs
          self={self}
          partner={partner}
          shares={shares}
          onSharesChange={() => {}}
        />
      )}
    </>,
  );
}

test("負担区分チップの aria-label とカスタム割合入力を保つ", () => {
  const html = renderPicker(
    [
      { memberId: self._id, ratioPercent: 70 },
      { memberId: partner._id, ratioPercent: 30 },
    ],
    true,
  );

  expect(html).toContain('aria-label="負担区分: カスタム"');
  expect(html).not.toContain("前回");
  expect(html.indexOf('aria-label="負担区分: カスタム"')).toBeLessThan(
    html.indexOf('aria-label="カスタム割合を入力"'),
  );
  expect(html).toContain('aria-label="カスタム割合を入力"');
  expect(html).toContain('aria-pressed="true"');
  expect(html).toContain('value="70"');
  expect(html).toContain('value="30"');
});

test("負担区分チップは折半・自分・相手の順に循環する", () => {
  const split: ShareRatio[] = [
    { memberId: self._id, ratioPercent: 50 },
    { memberId: partner._id, ratioPercent: 50 },
  ];
  const selfOnly: ShareRatio[] = [
    { memberId: self._id, ratioPercent: 100 },
    { memberId: partner._id, ratioPercent: 0 },
  ];
  const partnerOnly: ShareRatio[] = [
    { memberId: self._id, ratioPercent: 0 },
    { memberId: partner._id, ratioPercent: 100 },
  ];

  expect(nextPresetShares(split, self._id, partner._id)).toEqual(selfOnly);
  expect(nextPresetShares(selfOnly, self._id, partner._id)).toEqual(partnerOnly);
  expect(nextPresetShares(partnerOnly, self._id, partner._id)).toEqual(split);
});

test("前回の提案は印と読み上げを付ける", () => {
  const html = renderPicker(
    [
      { memberId: self._id, ratioPercent: 50 },
      { memberId: partner._id, ratioPercent: 50 },
    ],
    false,
    true,
  );

  expect(html).toContain('aria-label="負担区分: 折半（前回）"');
  expect(html).toContain(">前回<");
  expect(html).toContain("min-h-11");
  expect(html.indexOf('aria-label="負担区分: 折半（前回）"')).toBeLessThan(
    html.indexOf('aria-label="カスタム割合を入力"'),
  );
});
