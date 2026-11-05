// Turns raw pointer events on olex into gestures: pet, drag, or open the menu.

export type Gesture =
  | { kind: "pet" }
  | { kind: "dragStart"; x: number; y: number }
  | { kind: "dragMove"; x: number; y: number; vx: number }
  | { kind: "dragEnd" }
  | { kind: "menu"; x: number; y: number };

const TOUCH_DRAG_PX = 8;

export function createGestureTracker(opts: { dragPx: number; longPressMs: number }) {
  let down: { x: number; y: number; t: number; touch: boolean } | null = null;
  let dragging = false;
  let lastX = 0;

  const reset = () => {
    down = null;
    dragging = false;
  };

  return {
    down(x: number, y: number, t: number, button: number, touch: boolean): Gesture[] {
      reset();
      if (button === 2) return [{ kind: "menu", x, y }];
      if (button !== 0) return [];
      down = { x, y, t, touch };
      lastX = x;
      return [];
    },
    move(x: number, y: number, _t: number): Gesture[] {
      if (!down) return [];
      const out: Gesture[] = [];
      if (!dragging) {
        const threshold = down.touch ? Math.max(opts.dragPx, TOUCH_DRAG_PX) : opts.dragPx;
        if (Math.hypot(x - down.x, y - down.y) <= threshold) return [];
        dragging = true;
        out.push({ kind: "dragStart", x, y });
      }
      out.push({ kind: "dragMove", x, y, vx: x - lastX });
      lastX = x;
      return out;
    },
    up(_t: number): Gesture[] {
      if (!down) return [];
      const g: Gesture = dragging ? { kind: "dragEnd" } : { kind: "pet" };
      reset();
      return [g];
    },
    cancel(): Gesture[] {
      const was = dragging;
      reset();
      return was ? [{ kind: "dragEnd" }] : [];
    },
    // long-press on touch opens the menu
    tick(t: number): Gesture[] {
      if (!down || dragging || !down.touch || t - down.t < opts.longPressMs) return [];
      const g: Gesture = { kind: "menu", x: down.x, y: down.y };
      reset();
      return [g];
    },
    get active() {
      return down !== null;
    },
  };
}

export function attachInput(
  canvas: HTMLCanvasElement,
  onGesture: (g: Gesture) => void,
): { active: () => boolean; begin: (e: PointerEvent) => void } {
  const tracker = createGestureTracker({ dragPx: 4, longPressMs: 500 });
  let timer: ReturnType<typeof setInterval> | undefined;
  const emit = (gs: Gesture[]) => gs.forEach(onGesture);
  const stopTimer = () => clearInterval(timer);

  // starts a gesture; also called for touches caught on the document, since touch has no hover to enable the canvas first
  const begin = (e: PointerEvent) => {
    // a mouse drag on olex must not start a text selection on the page around him
    if (e.pointerType === "mouse" && e.button === 0) e.preventDefault();
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      // the pointer is already gone (or synthetic); the gesture still works without capture
    }
    emit(tracker.down(e.pageX, e.pageY, e.timeStamp, e.button, e.pointerType === "touch"));
    stopTimer();
    timer = setInterval(() => emit(tracker.tick(performance.now())), 50);
  };
  canvas.addEventListener("pointerdown", begin);
  canvas.addEventListener("pointermove", (e) => emit(tracker.move(e.pageX, e.pageY, e.timeStamp)));
  canvas.addEventListener("pointerup", (e) => {
    stopTimer();
    emit(tracker.up(e.timeStamp));
  });
  const cancel = () => {
    stopTimer();
    emit(tracker.cancel());
  };
  canvas.addEventListener("pointercancel", cancel);
  canvas.addEventListener("lostpointercapture", cancel);
  // the browser menu is only replaced over olex himself
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  return { active: () => tracker.active, begin };
}
