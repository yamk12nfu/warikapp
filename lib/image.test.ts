import { describe, expect, test } from "vitest";
import { fitWithinLongEdge, MAX_LONG_EDGE } from "./image";

// Canvasを使う圧縮本体はブラウザでの動作確認に任せ、寸法計算だけを検証する
// (縮小率を間違えるとAIに渡す画像が読めない大きさになるため)
describe("fitWithinLongEdge", () => {
  test("長辺が上限以下なら変えない", () => {
    expect(fitWithinLongEdge(1600, 1200)).toEqual({ width: 1600, height: 1200 });
  });

  test("横長は幅を上限に合わせ、縦横比を保つ", () => {
    expect(fitWithinLongEdge(4000, 3000)).toEqual({
      width: MAX_LONG_EDGE,
      height: 1500,
    });
  });

  test("縦長は高さを上限に合わせる(レシートはこちらが多い)", () => {
    expect(fitWithinLongEdge(1500, 6000)).toEqual({
      width: 500,
      height: MAX_LONG_EDGE,
    });
  });

  test("極端に細長い画像でも0pxにならない", () => {
    const result = fitWithinLongEdge(1, 20_000);
    expect(result.width).toBe(1);
    expect(result.height).toBe(MAX_LONG_EDGE);
  });

  test("寸法が取れない画像でも落ちない", () => {
    expect(fitWithinLongEdge(0, 0)).toEqual({ width: 0, height: 0 });
  });
});
