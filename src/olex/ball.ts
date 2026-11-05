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

// x, y in document px; y is where the ball touches the ground
export function setBall(layer: HTMLElement, at: { x: number; y: number } | null): void {
  if (!at) {
    el?.remove();
    el = null;
    return;
  }
  const b = sprite(layer);
  const half = (SPRITE.length * SCALE) / 2;
  b.style.transform = `translate(${Math.round(at.x - half)}px, ${Math.round(at.y - half * 2)}px)`;
}

// while `armed()` is true, a press-and-release anywhere except on olex throws the ball
export function attachThrow(opts: {
  armed: () => boolean;
  olex: HTMLElement;
  onThrow: (b: Ball) => void;
  onEnd: () => void;
}): void {
  let samples: { x: number; y: number; t: number }[] | null = null;
  let swallowClick = false;

  document.addEventListener("pointerdown", (e) => {
    if (!opts.armed() || e.target === opts.olex || e.button !== 0) return;
    e.preventDefault(); // no text selection while winding up
    samples = [{ x: e.pageX, y: e.pageY, t: e.timeStamp }];
  });
  document.addEventListener("pointermove", (e) => {
    if (!samples) return;
    samples.push({ x: e.pageX, y: e.pageY, t: e.timeStamp });
    if (samples.length > 20) samples.shift();
  }, { passive: true });
  document.addEventListener("pointerup", (e) => {
    if (!samples) return;
    samples.push({ x: e.pageX, y: e.pageY, t: e.timeStamp });
    const { vx, vy } = throwVelocity(samples);
    samples = null;
    swallowClick = true; // the release must not also follow a link
    opts.onThrow({ x: e.pageX, y: e.pageY, vx, vy, resting: false });
  });
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
