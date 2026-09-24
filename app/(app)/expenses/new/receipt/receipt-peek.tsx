"use client";

import {
  clampTransform,
  IDLE_GESTURE,
  reduceViewer,
  transformToCss,
  type Point,
} from "@/lib/receipt-zoom";
import {
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";

export type ReceiptPeekProps = {
  readonly image: Blob;
};

const TOOLBAR_ZOOM_FACTOR = 1.25;
const WHEEL_ZOOM_GAIN = 0.01;

const stripChromeClass =
  "flex w-full items-center gap-3 rounded-2xl border border-line bg-surface p-2 shadow-card";

export default function ReceiptPeek({ image }: ReceiptPeekProps) {
  const src = useObjectUrl(image);
  const [open, setOpen] = useState(false);
  return (
    <>
      <ReceiptPeekStrip src={src} onOpen={() => setOpen(true)} />
      {open ? (
        <ReceiptLightbox src={src} onClose={() => setOpen(false)} />
      ) : null}
    </>
  );
}

export type ReceiptPeekStripProps = {
  readonly src: string;
  readonly onOpen: () => void;
};

export function ReceiptPeekStrip({ src, onOpen }: ReceiptPeekStripProps) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label="レシート画像を拡大する"
      className={stripChromeClass}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt=""
        className="h-14 w-11 rounded-lg border border-line object-cover"
      />
      <span className="flex-1 text-left text-sm font-bold">レシートを確認</span>
      <span className="text-xs text-muted">拡大 →</span>
    </button>
  );
}

function ReceiptLightbox({
  src,
  onClose,
}: {
  readonly src: string;
  readonly onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [gesture, dispatch] = useReducer(reduceViewer, IDLE_GESTURE);

  function toPoint(event: { clientX: number; clientY: number }): Point {
    const stage = stageRef.current;
    if (stage === null) {
      return { x: 0, y: 0 };
    }
    const rect = stage.getBoundingClientRect();
    return {
      x: event.clientX - (rect.left + rect.width / 2),
      y: event.clientY - (rect.top + rect.height / 2),
    };
  }

  function measure() {
    const stage = stageRef.current;
    const img = imgRef.current;
    if (stage === null || img === null) {
      return;
    }
    if (img.naturalWidth === 0 || img.naturalHeight === 0) {
      return;
    }
    const rect = stage.getBoundingClientRect();
    const fit = Math.min(
      rect.width / img.naturalWidth,
      rect.height / img.naturalHeight,
    );
    dispatch({
      kind: "reframe",
      frame: {
        viewportWidth: rect.width,
        viewportHeight: rect.height,
        contentWidth: img.naturalWidth * fit,
        contentHeight: img.naturalHeight * fit,
      },
    });
  }

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) {
      return;
    }
    if (!dialog.open) {
      dialog.showModal();
    }
    measure();
  }, []);

  useEffect(() => {
    function onResize() {
      measure();
    }
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
    };
  }, []);

  useEffect(() => {
    const stage = stageRef.current;
    if (stage === null) {
      return;
    }
    function onWheel(event: WheelEvent) {
      event.preventDefault();
      dispatch({
        kind: "zoom-by",
        at: toPoint(event),
        factor: Math.exp(-event.deltaY * WHEEL_ZOOM_GAIN),
      });
    }
    stage.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      stage.removeEventListener("wheel", onWheel);
    };
  }, []);

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    dispatch({
      kind: "pointer-down",
      pointer: { id: event.pointerId, at: toPoint(event) },
    });
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    dispatch({
      kind: "pointer-move",
      pointer: { id: event.pointerId, at: toPoint(event) },
    });
  }

  function onPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    dispatch({ kind: "pointer-up", pointerId: event.pointerId });
  }

  const transform = clampTransform(gesture.transform, gesture.frame);

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      aria-labelledby="receipt-lightbox-title"
      className="fixed inset-0 h-full max-h-none w-full max-w-none border-0 bg-black/90 p-0 text-white"
    >
      <div className="pointer-events-none absolute inset-x-3 top-3 z-10 flex items-start justify-between gap-3">
        <h2 id="receipt-lightbox-title" className="text-sm">
          ピンチ / ドラッグで確認
        </h2>
        <form method="dialog" className="pointer-events-auto">
          <button
            type="submit"
            className="rounded-full bg-white/15 px-3.5 py-2 text-sm"
          >
            閉じる
          </button>
        </form>
      </div>
      <div
        ref={stageRef}
        className="flex h-full w-full touch-none items-center justify-center overflow-hidden"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          ref={imgRef}
          src={src}
          alt="レシート"
          draggable={false}
          onLoad={measure}
          style={{
            transform: transformToCss(transform),
            transformOrigin: "center center",
          }}
          className="max-h-full max-w-full select-none object-contain"
        />
      </div>
      <div className="absolute inset-x-3 bottom-3 z-10 flex justify-center gap-2">
        <button
          type="button"
          className="rounded-full bg-white/15 px-3.5 py-2 text-sm"
          onClick={() =>
            dispatch({
              kind: "zoom-by",
              at: { x: 0, y: 0 },
              factor: 1 / TOOLBAR_ZOOM_FACTOR,
            })
          }
        >
          縮小
        </button>
        <button
          type="button"
          className="rounded-full bg-white/15 px-3.5 py-2 text-sm"
          onClick={() =>
            dispatch({
              kind: "zoom-by",
              at: { x: 0, y: 0 },
              factor: TOOLBAR_ZOOM_FACTOR,
            })
          }
        >
          拡大
        </button>
        <button
          type="button"
          className="rounded-full bg-white/15 px-3.5 py-2 text-sm"
          onClick={() => dispatch({ kind: "reset" })}
        >
          リセット
        </button>
      </div>
    </dialog>
  );
}

// object URL は描画に必要な派生値なので useMemo で作る。
// effect 内で setState すると react-hooks/set-state-in-effect に落ちる。
function useObjectUrl(blob: Blob): string {
  const url = useMemo(() => URL.createObjectURL(blob), [blob]);
  useEffect(() => {
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [url]);
  return url;
}
