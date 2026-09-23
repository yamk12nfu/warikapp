import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import {
  ReceiptImageInputs,
  ReceiptWorkingSteps,
  workingStepState,
} from "./receipt-client";

test("再読み取りは読み取りから始まり、それより前の工程は済になる", () => {
  expect(workingStepState("compress", "parse")).toBe("done");
  expect(workingStepState("upload", "parse")).toBe("done");
  expect(workingStepState("parse", "parse")).toBe("current");
  expect(workingStepState("draft", "parse")).toBe("pending");
});

test("撮影から始めると縮小だけが現在の工程になる", () => {
  expect(workingStepState("compress", "compress")).toBe("current");
  expect(workingStepState("upload", "compress")).toBe("pending");
  expect(workingStepState("parse", "compress")).toBe("pending");
  expect(workingStepState("draft", "compress")).toBe("pending");
});

test("再読み取り中は読み取りが現在で、縮小とアップロードは済と出る", () => {
  const html = renderToStaticMarkup(<ReceiptWorkingSteps step="parse" />);

  expect(html).toContain("画像を小さくしています");
  expect(html).toContain("アップロードしています");
  expect(html).toContain("レシートを読み取っています");
  expect(html).toContain("下書きを保存しています");
  expect(html).toContain('aria-current="step"');
  expect(html.indexOf("✓")).toBeLessThan(html.indexOf("レシートを読み取っています"));
  expect(html.indexOf('aria-current="step"')).toBeLessThan(
    html.indexOf("レシートを読み取っています"),
  );
  expect(html.indexOf("下書きを保存しています")).toBeGreaterThan(
    html.indexOf("レシートを読み取っています"),
  );
  expect(html).toContain("text-muted");
});

test("撮影はカメラを開き、アルバムはキャプチャ属性を付けない", () => {
  const html = renderToStaticMarkup(
    <ReceiptImageInputs onFileChange={() => {}} />,
  );
  const cameraTag = html.slice(
    html.indexOf('id="receipt-camera"'),
    html.indexOf('id="receipt-album"'),
  );
  const albumTag = html.slice(html.indexOf('id="receipt-album"'));

  expect(html).toContain("撮影する");
  expect(html).toContain("アルバムから選ぶ");
  expect(cameraTag).toContain('capture="environment"');
  expect(cameraTag).toContain('accept="image/*"');
  expect(albumTag).toContain('accept="image/*"');
  expect(albumTag).not.toContain("capture");
});
