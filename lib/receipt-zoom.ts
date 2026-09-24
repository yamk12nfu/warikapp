export type Point = { readonly x: number; readonly y: number };

export type ViewerTransform = {
  readonly scale: number;
  readonly x: number;
  readonly y: number;
};

export type ViewerFrame = {
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  readonly contentWidth: number;
  readonly contentHeight: number;
};

export type ActivePointer = { readonly id: number; readonly at: Point };

export type ViewerGesture = {
  readonly transform: ViewerTransform;
  readonly frame: ViewerFrame;
  readonly pointers: readonly ActivePointer[];
};

export type ViewerEvent =
  | { readonly kind: "reframe"; readonly frame: ViewerFrame }
  | { readonly kind: "pointer-down"; readonly pointer: ActivePointer }
  | { readonly kind: "pointer-move"; readonly pointer: ActivePointer }
  | { readonly kind: "pointer-up"; readonly pointerId: number }
  | { readonly kind: "zoom-by"; readonly at: Point; readonly factor: number }
  | { readonly kind: "toggle-zoom"; readonly at: Point }
  | { readonly kind: "reset" };

export const MIN_SCALE = 1;
export const MAX_SCALE = 4;
export const DOUBLE_TAP_SCALE = 2.5;

export const IDENTITY_TRANSFORM: ViewerTransform = {
  scale: MIN_SCALE,
  x: 0,
  y: 0,
};

export const EMPTY_FRAME: ViewerFrame = {
  viewportWidth: 0,
  viewportHeight: 0,
  contentWidth: 0,
  contentHeight: 0,
};

export const IDLE_GESTURE: ViewerGesture = {
  transform: IDENTITY_TRANSFORM,
  frame: EMPTY_FRAME,
  pointers: [],
};

export function maxOffset(
  contentLength: number,
  viewportLength: number,
  scale: number,
): number {
  return Math.max(0, (contentLength * scale - viewportLength) / 2);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function clampTransform(
  transform: ViewerTransform,
  frame: ViewerFrame,
): ViewerTransform {
  const scale = clamp(transform.scale, MIN_SCALE, MAX_SCALE);
  const limitX = maxOffset(frame.contentWidth, frame.viewportWidth, scale);
  const limitY = maxOffset(frame.contentHeight, frame.viewportHeight, scale);
  return {
    scale,
    x: clamp(transform.x, -limitX, limitX),
    y: clamp(transform.y, -limitY, limitY),
  };
}

function pinchOf(
  pointers: readonly ActivePointer[],
): { readonly distance: number; readonly center: Point } | null {
  if (pointers.length !== 2) {
    return null;
  }
  const first = pointers[0];
  const second = pointers[1];
  if (first === undefined || second === undefined) {
    return null;
  }
  const dx = second.at.x - first.at.x;
  const dy = second.at.y - first.at.y;
  return {
    distance: Math.hypot(dx, dy),
    center: {
      x: (first.at.x + second.at.x) / 2,
      y: (first.at.y + second.at.y) / 2,
    },
  };
}

function zoomAround(
  transform: ViewerTransform,
  at: Point,
  nextScale: number,
): ViewerTransform {
  const ratio = nextScale / transform.scale;
  return {
    scale: nextScale,
    x: at.x - (at.x - transform.x) * ratio,
    y: at.y - (at.y - transform.y) * ratio,
  };
}

function replacePointer(
  pointers: readonly ActivePointer[],
  pointer: ActivePointer,
): ActivePointer[] {
  const index = pointers.findIndex((entry) => entry.id === pointer.id);
  if (index === -1) {
    return [...pointers, pointer];
  }
  const next = pointers.slice();
  next[index] = pointer;
  return next;
}

function withClampedTransform(
  state: ViewerGesture,
  transform: ViewerTransform,
  pointers: readonly ActivePointer[] = state.pointers,
  frame: ViewerFrame = state.frame,
): ViewerGesture {
  return {
    transform: clampTransform(transform, frame),
    frame,
    pointers,
  };
}

export function reduceViewer(
  state: ViewerGesture,
  event: ViewerEvent,
): ViewerGesture {
  switch (event.kind) {
    case "reframe":
      return withClampedTransform(state, state.transform, state.pointers, event.frame);
    case "pointer-down":
      return withClampedTransform(
        state,
        state.transform,
        replacePointer(state.pointers, event.pointer),
      );
    case "pointer-up":
      return withClampedTransform(
        state,
        state.transform,
        state.pointers.filter((pointer) => pointer.id !== event.pointerId),
      );
    case "pointer-move": {
      const before = pinchOf(state.pointers);
      const pointers = replacePointer(state.pointers, event.pointer);
      const previous = state.pointers.find((pointer) => pointer.id === event.pointer.id);
      if (state.pointers.length === 1 && previous !== undefined) {
        return withClampedTransform(
          state,
          {
            scale: state.transform.scale,
            x: state.transform.x + (event.pointer.at.x - previous.at.x),
            y: state.transform.y + (event.pointer.at.y - previous.at.y),
          },
          pointers,
        );
      }
      const after = pinchOf(pointers);
      if (before === null || after === null || before.distance === 0) {
        return withClampedTransform(state, state.transform, pointers);
      }
      const zoomed = zoomAround(
        state.transform,
        before.center,
        state.transform.scale * (after.distance / before.distance),
      );
      return withClampedTransform(
        state,
        {
          scale: zoomed.scale,
          x: zoomed.x + (after.center.x - before.center.x),
          y: zoomed.y + (after.center.y - before.center.y),
        },
        pointers,
      );
    }
    case "zoom-by":
      return withClampedTransform(
        state,
        zoomAround(
          state.transform,
          event.at,
          state.transform.scale * event.factor,
        ),
      );
    case "toggle-zoom":
      if (state.transform.scale > MIN_SCALE) {
        return withClampedTransform(state, IDENTITY_TRANSFORM);
      }
      return withClampedTransform(
        state,
        zoomAround(state.transform, event.at, DOUBLE_TAP_SCALE),
      );
    case "reset":
      return withClampedTransform(state, IDENTITY_TRANSFORM);
    default: {
      const _exhaustive: never = event;
      return _exhaustive;
    }
  }
}

export function transformToCss(transform: ViewerTransform): string {
  return `translate3d(${transform.x}px, ${transform.y}px, 0) scale(${transform.scale})`;
}
