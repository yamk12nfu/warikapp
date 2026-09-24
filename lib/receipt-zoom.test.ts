import { describe, expect, test } from "vitest";
import {
  clampTransform,
  DOUBLE_TAP_SCALE,
  IDLE_GESTURE,
  IDENTITY_TRANSFORM,
  MAX_SCALE,
  MIN_SCALE,
  reduceViewer,
  transformToCss,
  type ViewerEvent,
  type ViewerFrame,
  type ViewerGesture,
} from "./receipt-zoom";

const FRAME: ViewerFrame = {
  viewportWidth: 400,
  viewportHeight: 600,
  contentWidth: 300,
  contentHeight: 500,
};

function framed(events: ViewerEvent[] = []): ViewerGesture {
  return events.reduce(reduceViewer, reduceViewer(IDLE_GESTURE, { kind: "reframe", frame: FRAME }));
}

function screenOf(
  transform: ViewerGesture["transform"],
  local: { x: number; y: number },
): { x: number; y: number } {
  return {
    x: transform.x + local.x * transform.scale,
    y: transform.y + local.y * transform.scale,
  };
}

describe("reduceViewer", () => {
  test("等倍では1本指ドラッグで動かない", () => {
    const dragged = framed([
      { kind: "pointer-down", pointer: { id: 1, at: { x: 0, y: 0 } } },
      { kind: "pointer-move", pointer: { id: 1, at: { x: 80, y: 40 } } },
    ]);

    expect(dragged.transform).toEqual({ scale: 1, x: 0, y: 0 });
  });

  test("拡大中のドラッグは許容量で飽和する", () => {
    const dragged = framed([
      { kind: "zoom-by", at: { x: 0, y: 0 }, factor: 2 },
      { kind: "pointer-down", pointer: { id: 1, at: { x: 0, y: 0 } } },
      { kind: "pointer-move", pointer: { id: 1, at: { x: 9999, y: 0 } } },
    ]);

    expect(dragged.transform).toEqual({ scale: 2, x: 100, y: 0 });
  });

  test("2本指を広げると拡大し、中点の下の点は中点に追従する", () => {
    const twoDown = framed([
      { kind: "pointer-down", pointer: { id: 1, at: { x: -40, y: 0 } } },
      { kind: "pointer-down", pointer: { id: 2, at: { x: 40, y: 0 } } },
    ]);
    const spread = framed([
      { kind: "pointer-down", pointer: { id: 1, at: { x: -40, y: 0 } } },
      { kind: "pointer-down", pointer: { id: 2, at: { x: 40, y: 0 } } },
      { kind: "pointer-move", pointer: { id: 1, at: { x: -80, y: 0 } } },
      { kind: "pointer-move", pointer: { id: 2, at: { x: 80, y: 0 } } },
    ]);

    expect(spread.transform.scale).toBe(2);
    expect(spread.transform.x).toBe(0);
    expect(spread.transform.y).toBe(0);
    expect(screenOf(spread.transform, { x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
    expect(twoDown.transform).toEqual(IDENTITY_TRANSFORM);
  });

  test("0本指の pointer-move では transform が変わらない", () => {
    const moved = framed([
      { kind: "pointer-move", pointer: { id: 1, at: { x: 40, y: 10 } } },
    ]);

    expect(moved.transform).toEqual(IDENTITY_TRANSFORM);
  });

  test("3本指の pointer-move では transform が変わらない", () => {
    const three = framed([
      { kind: "pointer-down", pointer: { id: 1, at: { x: -50, y: 0 } } },
      { kind: "pointer-down", pointer: { id: 2, at: { x: 50, y: 0 } } },
      { kind: "pointer-down", pointer: { id: 3, at: { x: 0, y: 40 } } },
    ]);
    const moved = reduceViewer(three, {
      kind: "pointer-move",
      pointer: { id: 1, at: { x: -200, y: 0 } },
    });

    expect(moved.transform).toEqual(three.transform);
    expect(moved.pointers).toEqual([
      { id: 1, at: { x: -200, y: 0 } },
      { id: 2, at: { x: 50, y: 0 } },
      { id: 3, at: { x: 0, y: 40 } },
    ]);
  });

  test("toggle-zoom は等倍と 2.5 倍を往復する", () => {
    const zoomed = framed([{ kind: "toggle-zoom", at: { x: 0, y: 0 } }]);
    const restored = reduceViewer(zoomed, {
      kind: "toggle-zoom",
      at: { x: 0, y: 0 },
    });

    expect(zoomed.transform).toEqual({ scale: DOUBLE_TAP_SCALE, x: 0, y: 0 });
    expect(restored.transform).toEqual(IDENTITY_TRANSFORM);
  });

  test("scale は MIN_SCALE と MAX_SCALE で止まる", () => {
    const tooSmall = framed([
      { kind: "zoom-by", at: { x: 0, y: 0 }, factor: 0.1 },
    ]);
    const tooBig = framed([
      { kind: "zoom-by", at: { x: 0, y: 0 }, factor: 20 },
    ]);

    expect(tooSmall.transform.scale).toBe(MIN_SCALE);
    expect(tooBig.transform.scale).toBe(MAX_SCALE);
  });

  test("reframe は拡大率を保ったまま新しい frame で clamp し直す", () => {
    const zoomed = framed([
      { kind: "zoom-by", at: { x: 0, y: 0 }, factor: 2 },
      { kind: "pointer-down", pointer: { id: 1, at: { x: 0, y: 0 } } },
      { kind: "pointer-move", pointer: { id: 1, at: { x: 100, y: 0 } } },
    ]);
    const rotated = reduceViewer(zoomed, {
      kind: "reframe",
      frame: {
        viewportWidth: 800,
        viewportHeight: 400,
        contentWidth: 300,
        contentHeight: 500,
      },
    });

    expect(zoomed.transform).toEqual({ scale: 2, x: 100, y: 0 });
    expect(rotated.transform).toEqual({ scale: 2, x: 0, y: 0 });
  });

  test("toolbar の zoom-by は中心を錨に段階拡大する", () => {
    const zoomed = framed([
      { kind: "zoom-by", at: { x: 0, y: 0 }, factor: 1.25 },
    ]);

    expect(zoomed.transform).toEqual({ scale: 1.25, x: 0, y: 0 });
  });

  test("reset は開いたまま等倍・中央へ戻す", () => {
    const reset = framed([
      { kind: "zoom-by", at: { x: 0, y: 0 }, factor: 2 },
      { kind: "pointer-down", pointer: { id: 1, at: { x: 0, y: 0 } } },
      { kind: "pointer-move", pointer: { id: 1, at: { x: 40, y: 20 } } },
      { kind: "reset" },
    ]);

    expect(reset.transform).toEqual(IDENTITY_TRANSFORM);
    expect(reset.pointers).toEqual([{ id: 1, at: { x: 40, y: 20 } }]);
  });
});

describe("clampTransform", () => {
  test("同じ入力を二度通しても結果は変わらない", () => {
    const wild = { scale: 99, x: 9_000, y: -9_000 };
    const once = clampTransform(wild, FRAME);
    const twice = clampTransform(once, FRAME);

    expect(once).toEqual({ scale: 4, x: 400, y: -700 });
    expect(twice).toEqual(once);
  });
});

describe("transformToCss", () => {
  test("合成レイヤ向けの translate3d と scale になる", () => {
    expect(transformToCss({ scale: 2.5, x: 12, y: -8 })).toBe(
      "translate3d(12px, -8px, 0) scale(2.5)",
    );
  });
});
