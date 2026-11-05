// Wires the model, world, and brain to the page: one loop, one canvas.

import { build, render, paint, scruffOffset, BUFFER } from "./model";
import { attachInput, type Gesture } from "./input";
import { measure, type Platform } from "./world";
import { initState, tick, onPageSwap, handle, type State, type World } from "./brain";

const SCALE = 2;
const REMEASURE_MS = 3000;
const OFFSCREEN_POLL_MS = 500;

let started = false;
let canvas: HTMLCanvasElement;
let ctx: CanvasRenderingContext2D;
let buf: HTMLCanvasElement;
let bctx: CanvasRenderingContext2D;
let state: State;
let world: World;
let lastOut: (string | null)[] = [];
let origin = { x: 0, y: 0 };   // document position of the canvas' top-left
let lastMeasure = 0;
let running = false;
let hovering = false;
let input: { active: () => boolean };
let tag: HTMLElement;
let layer: HTMLElement;

const reduced = matchMedia("(prefers-reduced-motion: reduce)");

function view() {
  return { top: scrollY, bottom: scrollY + innerHeight };
}

function remeasure(): void {
  world.plats = measure(document);
  lastMeasure = performance.now();
}

function isOffscreen(): boolean {
  const v = view();
  return state.y < v.top || state.y - 60 > v.bottom;
}

function draw(): void {
  const { W, H } = BUFFER;
  const m = state.mode;
  const airborne = m === "carried" || m === "drop";
  lastOut = render(W, H, {
    yaw: state.yaw,
    walk: m === "walk" || m === "hop" || m === "carried" ? state.walk % 1 : null,
    tongue: m === "pet" || m === "carried" || m === "spin",
    pose: state.pose,
    poseT: state.poseT,
    hang: airborne ? state.swingA : null,
  });
  paint(bctx, lastOut, W, H);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(buf, 0, 0, W * SCALE, H * SCALE);
  origin = airborne
    ? { x: Math.round(state.pivot.x - (W / 2) * SCALE), y: Math.round(state.pivot.y - BUFFER.HANG_Y * SCALE) }
    : { x: Math.round(state.x - (W / 2) * SCALE), y: Math.round(state.y - (H - BUFFER.GROUND) * SCALE) };
  canvas.style.transform = `translate(${origin.x}px, ${origin.y}px)`;
  canvas.classList.toggle("carried", m === "carried");

  tag.hidden = !(hovering || m === "carried");
  const top = airborne ? state.pivot.y - 34 : state.y - 30 * SCALE;
  tag.style.transform = `translate(${Math.round(state.x)}px, ${Math.round(top)}px) translateX(-50%)`;
}

function heart(): void {
  const h = document.createElement("div");
  h.className = "olex-heart";
  h.textContent = "♥";
  h.style.transform = `translate(${Math.round(state.x)}px, ${Math.round(state.y - 44 * SCALE / 2 - 20)}px)`;
  layer.appendChild(h);
  setTimeout(() => h.remove(), 900);
}

function onGesture(g: Gesture): void {
  handle(state, g, world);
  if (g.kind === "pet" && (state.mode === "pet" || state.mode === "spin")) heart();
}

function frame(): void {
  if (!running) return;
  const now = performance.now();
  if (now - lastMeasure > REMEASURE_MS) remeasure();
  world.now = now;
  world.view = view();
  world.reducedMotion = reduced.matches;
  const sel = document.getSelection();
  world.paused = !!sel && !sel.isCollapsed;
  tick(state, world);
  if (isOffscreen()) {
    // keep thinking (so he can come back) but skip drawing
    setTimeout(frame, OFFSCREEN_POLL_MS);
    return;
  }
  draw();
  requestAnimationFrame(frame);
}

function run(): void {
  if (running || document.hidden) return;
  running = true;
  requestAnimationFrame(frame);
}

function stop(): void {
  running = false;
}

// only olex's opaque pixels take the pointer, so links under his empty corners stay clickable
function hitTest(e: PointerEvent): void {
  // never drop pointer capture mid-gesture
  if (input.active()) return;
  const { W, H } = BUFFER;
  const px = Math.floor((e.pageX - origin.x) / SCALE);
  const py = Math.floor((e.pageY - origin.y) / SCALE);
  const hit = px >= 0 && py >= 0 && px < W && py < H && !!lastOut[py * W + px];
  canvas.style.pointerEvents = hit ? "auto" : "none";
  hovering = hit;
}

export function start(): void {
  if (started) return;
  const el = document.getElementById("olex") as HTMLCanvasElement | null;
  if (!el) return;
  started = true;
  canvas = el;
  ctx = canvas.getContext("2d")!;
  const { W, H } = BUFFER;
  canvas.width = W * SCALE;
  canvas.height = H * SCALE;
  ctx.imageSmoothingEnabled = false;
  buf = document.createElement("canvas");
  buf.width = W;
  buf.height = H;
  bctx = buf.getContext("2d")!;

  layer = document.getElementById("olex-layer")!;
  tag = document.getElementById("olex-tag")!;
  build();
  world = {
    plats: [] as Platform[], view: view(), now: performance.now(), reducedMotion: reduced.matches, paused: false,
    rand: Math.random,
    scruff: (yaw) => {
      const [x, y] = scruffOffset(yaw);
      return [x * SCALE, y * SCALE];
    },
  };
  remeasure();
  state = initState(world);

  let resizeTimer: ReturnType<typeof setTimeout> | undefined;
  addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(remeasure, 150);
  });
  document.fonts?.ready.then(remeasure);
  addEventListener("load", remeasure);
  // a new page was swapped in under the persisted canvas; wait for the scroll reset, then let him land
  let swapped = false;
  document.addEventListener("astro:after-swap", () => (swapped = true));
  document.addEventListener("astro:page-load", () => {
    if (!swapped) return;
    swapped = false;
    remeasure();
    world.view = view();
    onPageSwap(state, world);
  });
  document.addEventListener("pointermove", hitTest, { passive: true });
  input = attachInput(canvas, onGesture);
  document.addEventListener("visibilitychange", () => (document.hidden ? stop() : run()));
  run();
}
