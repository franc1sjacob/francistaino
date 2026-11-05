// The fetch ball on the page: drawn as a few pixels, flicked with the pointer.

import { throwVelocity, type Ball } from "./physics";

const SCALE = 2;
const SPRITE = [".###.", "#####", "#####", "#####", ".###."];
const SHADE = ["", "#f2b49f", "#d97757", "#d97757", "#bd5d3a"]; // lighter on top

let el: HTMLCanvasElement | null = null;

function sprite(layer: HTMLElement): HTMLCanvasElement {
  if (el) return el;
  el = document.createElement("canvas");
  el.className = "olex-ball";
  el.width = SPRITE[0].length;
  el.height = SPRITE.length;
  const c = el.getContext("2d")!;
  SPRITE.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      if (ch !== "#") return;
      c.fillStyle = SHADE[y] || "#e8957a";
      c.fillRect(x, y, 1, 1);
    }),
  );
  layer.appendChild(el);
  return el;
}

// x, y in document px; y is where the ball touches the ground.
// grabbable: on touch screens the ball itself is what you pick up and flick
export function setBall(layer: HTMLElement, at: { x: number; y: number } | null, grabbable = false): void {
  if (!at) {
    el?.remove();
    el = null;
    return;
  }
  const b = sprite(layer);
  b.classList.toggle("grabbable", grabbable);
  const half = (SPRITE.length * SCALE) / 2;
  b.style.transform = `translate(${Math.round(at.x - half)}px, ${Math.round(at.y - half * 2)}px)`;
}

const THROW_PX = 6;

// a release only throws if the pointer actually moved; a plain click passes through to the page
export function isThrow(samples: { x: number; y: number }[]): boolean {
  if (samples.length < 2) return false;
  const a = samples[0], b = samples[samples.length - 1];
  return Math.hypot(b.x - a.x, b.y - a.y) > THROW_PX;
}

// While `armed()` is true:
// - mouse: the ball rides on the cursor, and a press-and-flick anywhere except on olex throws it
// - touch: only a press on the ball itself picks it up (the rest of the page still scrolls);
//   it follows your finger and a flick throws it
export function attachThrow(opts: {
  armed: () => boolean;
  olex: HTMLElement;
  onHold: (at: { x: number; y: number } | null) => void;
  onThrow: (b: Ball) => void;
  onEnd: () => void;
}): void {
  let samples: { x: number; y: number; t: number }[] | null = null;
  let touching = false;
  let swallowClick = false;

  const drop = () => {
    samples = null;
    if (touching) opts.onHold(null);
    touching = false;
  };

  document.addEventListener("pointerdown", (e) => {
    swallowClick = false; // never let a stale flag eat an unrelated click later
    if (!opts.armed() || e.target === opts.olex || e.button !== 0) return;
    if (e.pointerType === "mouse") {
      e.preventDefault(); // no text selection while winding up
    } else {
      if (!el || e.target !== el) return; // touch: only the ball itself
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        // synthetic or already-gone pointer: moves still bubble here
      }
      touching = true;
      opts.onHold({ x: e.pageX, y: e.pageY });
    }
    samples = [{ x: e.pageX, y: e.pageY, t: e.timeStamp }];
  });
  document.addEventListener("pointermove", (e) => {
    if (!samples) return;
    samples.push({ x: e.pageX, y: e.pageY, t: e.timeStamp });
    if (samples.length > 20) samples.shift();
    if (touching) opts.onHold({ x: e.pageX, y: e.pageY });
  }, { passive: true });
  document.addEventListener("pointerup", (e) => {
    if (!samples) return;
    samples.push({ x: e.pageX, y: e.pageY, t: e.timeStamp });
    const flicked = isThrow(samples);
    const { vx, vy } = throwVelocity(samples);
    const wasTouch = touching;
    drop();
    if (!flicked) return;
    if (!wasTouch) swallowClick = true; // a mouse release must not also follow a link
    opts.onThrow({ x: e.pageX, y: e.pageY, vx, vy, resting: false });
  });
  document.addEventListener("pointercancel", drop);
  document.addEventListener("click", (e) => {
    if (!swallowClick) return;
    swallowClick = false;
    e.preventDefault();
    e.stopPropagation();
  }, true);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && opts.armed()) opts.onEnd();
  });
}
