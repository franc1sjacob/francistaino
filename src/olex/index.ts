// Wires the model, world, and brain to the page: one loop, one canvas.

import { build, render, paint, scruffOffset, BUFFER } from "./model";
import { attachInput, type Gesture } from "./input";
import { opaqueAt } from "./hit";
import { measure, measureHouse, type Platform } from "./world";
import { store } from "./store";
import { createPetCounter } from "./pets";
import { COUNTER_URL } from "./config";
import { fixedSteps } from "./physics";
import { initState, tick, onPageSwap, handle, runCommand, clickAnywhere, throwBall, endFetch, callOut, houseInFront, type State, type World } from "./brain";
import { attachThrow, setBall } from "./ball";
import { openMenu } from "./menu";

const SCALE = 2;
const REMEASURE_MS = 3000;

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
let input: ReturnType<typeof attachInput>;
let tag: HTMLElement;
let layer: HTMLElement;
let tagCounts: HTMLElement;
const pets = createPetCounter({
  url: COUNTER_URL,
  fetch: (...a) => fetch(...a),
  now: () => performance.now(),
  beacon: (url, body) => navigator.sendBeacon?.(url, body) ?? false,
  store,
});
let bone: HTMLCanvasElement | null = null;
let legsMoving = false;
let tickAcc = 0;
let lastFrame = 0;

const reduced = matchMedia("(prefers-reduced-motion: reduce)");

function view() {
  return { top: scrollY, bottom: scrollY + innerHeight };
}

function remeasure(): void {
  world.plats = measure(document);
  const h = measureHouse(document);
  world.house = h && { x1: h.x1, x2: h.x2, y: h.y };
  // the ball bounces off the edges of the content column, where there is ground to land on
  const floor = world.plats.find((p) => p.kind === "floor");
  world.bounds = floor ? { left: floor.x1, right: floor.x2 } : { left: 0, right: document.documentElement.scrollWidth };
  lastMeasure = performance.now();
}

function isOffscreen(): boolean {
  if (state.mode === "fall" || state.mode === "drop") return false; // falling: keep full speed so he lands or comes back
  const v = view();
  return state.y < v.top || state.y - 60 > v.bottom;
}

function draw(): void {
  const { W, H } = BUFFER;
  const m = state.mode;
  const airborne = m === "carried" || m === "drop";
  lastOut = render(W, H, {
    yaw: state.yaw,
    // legs move whenever the brain advanced the walk cycle this frame
    walk: legsMoving ? state.walk % 1 : null,
    tongue: m === "pet" || m === "carried" || m === "spin" || state.idle === "yawn",
    tailWag: state.wag,
    ball: state.fetch?.phase === "carry",
    scratch: state.idle === "scratch" && state.poseT > 0.9 ? state.phase : null,
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
  // the footer is replaced on navigation, so look the house up each frame (cheap)
  document.getElementById("olex-house")?.classList.toggle("in-front", houseInFront(state, world));
  drawBone();
  drawBall();
  drawStars();

  tag.hidden = !(hovering || m === "carried");
  const top = airborne ? state.pivot.y - 34 : state.y - 30 * SCALE;
  tag.style.transform = `translate(${Math.round(state.x)}px, ${Math.round(top)}px) translateX(-50%)`;
}

let lastZ = 0;
function snore(now: number): void {
  if (state.idle !== "nap" || state.poseT < 1 || now - lastZ < 1400) return;
  lastZ = now;
  const z = document.createElement("div");
  z.className = "olex-z";
  z.textContent = "z";
  z.style.transform = `translate(${Math.round(state.x + 10)}px, ${Math.round(state.y - 30)}px)`;
  layer.appendChild(z);
  setTimeout(() => z.remove(), 1800);
}

// a tiny pixel bone for the treat command
const BONE = ["#.....#", "##...##", ".#####.", "##...##", "#.....#"];
function drawBone(): void {
  if (!state.treat) {
    bone?.remove();
    bone = null;
    return;
  }
  if (!bone) {
    bone = document.createElement("canvas");
    bone.className = "olex-bone";
    bone.width = BONE[0].length;
    bone.height = BONE.length;
    const c = bone.getContext("2d")!;
    c.fillStyle = "#efe6d6";
    BONE.forEach((row, y) => [...row].forEach((ch, x) => ch === "#" && c.fillRect(x, y, 1, 1)));
    layer.appendChild(bone);
  }
  bone.style.transform = `translate(${Math.round(state.treat.x - 7)}px, ${Math.round(world.plats[state.plat]?.y - 10)}px)`;
}

// cartoon stars circling his head while he is dizzy
const STAR_COLORS = ["var(--accent)", "#f5d76e", "var(--accent)"];
let stars: HTMLElement[] = [];
function drawStars(): void {
  const dizzy = state.mode === "dizzy";
  if (!dizzy) {
    stars.forEach((st) => st.remove());
    stars = [];
    return;
  }
  if (!stars.length) {
    stars = STAR_COLORS.map((color) => {
      const st = document.createElement("div");
      st.className = "olex-star";
      st.textContent = "✦";
      st.style.color = color;
      layer.appendChild(st);
      return st;
    });
  }
  const [sx, sy] = world.scruff(state.yaw);
  const hx = state.x + sx * 1.2, hy = state.y - sy - 20;
  const spin = world.reducedMotion ? 0 : performance.now() * 0.005;
  stars.forEach((st, i) => {
    const a = spin + (i * Math.PI * 2) / stars.length;
    // a flat ellipse, the back star dimmer as if behind his head
    st.style.transform = `translate(${Math.round(hx + Math.cos(a) * 18 - 5)}px, ${Math.round(hy + Math.sin(a) * 5 - 10)}px)`;
    st.style.opacity = Math.sin(a) < 0 ? "0.55" : "1";
  });
}

let heldBall: { x: number; y: number } | null = null; // where a finger is holding the ball

function drawBall(): void {
  const f = state.fetch;
  if (!f || f.phase === "carry") return setBall(layer, null);
  if (f.phase === "chase" && f.ball) return setBall(layer, f.ball);
  if (heldBall) return setBall(layer, { x: heldBall.x, y: heldBall.y + 5 }, true);
  // waiting: with a mouse the ball rides on the cursor; on touch it lies at his feet to be picked up
  const c = world.cursor;
  if (c) setBall(layer, { x: c.x + 10, y: c.y + 14 });
  else setBall(layer, { x: state.x + 26, y: state.y }, true);
}

// keeps the page and storage in step with whether he is home
function setHome(home: boolean): void {
  canvas.style.visibility = home ? "hidden" : "";
  if (home) {
    tag.hidden = true;
    setBall(layer, null);
    bone?.remove();
    bone = null;
  }
  store.setHome(home);
  if (home) houseSnores();
}

// a z drifts out of the door now and then while he sleeps inside
let snoreTimer: ReturnType<typeof setTimeout> | undefined;
function houseSnores(): void {
  clearTimeout(snoreTimer);
  if (state.mode !== "home" || !world.house) return;
  if (!document.hidden) {
    const z = document.createElement("div");
    z.className = "olex-z";
    z.textContent = "z";
    z.style.transform = `translate(${Math.round((world.house.x1 + world.house.x2) / 2)}px, ${Math.round(world.house.y - 26)}px)`;
    layer.appendChild(z);
    setTimeout(() => z.remove(), 1800);
  }
  snoreTimer = setTimeout(houseSnores, 2600);
}

// clicking the doghouse brings him back out
function callOutOfHouse(): void {
  if (state.mode !== "home") return;
  remeasure();
  callOut(state, world);
  setHome(false);
  run();
}

function heart(): void {
  const h = document.createElement("div");
  h.className = "olex-heart";
  h.textContent = "♥";
  h.style.transform = `translate(${Math.round(state.x)}px, ${Math.round(state.y - 44 * SCALE / 2 - 20)}px)`;
  layer.appendChild(h);
  setTimeout(() => h.remove(), 900);
}

function updateTag(): void {
  tagCounts.textContent = ` · ${pets.label()}`;
}

function onGesture(g: Gesture): void {
  // seeing stars: no menu, and clicks don't count as pets
  if (state.mode === "dizzy" && (g.kind === "pet" || g.kind === "menu")) return;
  if (g.kind === "pet") {
    pets.pet();
    void pets.flush().then(updateTag);
    updateTag();
  }
  if (g.kind === "menu") {
    openMenu(g.x - scrollX, g.y - scrollY, (c) => runCommand(state, c, world));
    return;
  }
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
  world.hover = hovering;
  // the brain runs at a fixed 60 ticks/s whatever the display's refresh rate
  const { steps, acc } = fixedSteps(tickAcc, lastFrame ? now - lastFrame : 0);
  tickAcc = acc;
  lastFrame = now;
  let hearts = 0;
  const walkBefore = state.walk;
  for (let i = 0; i < steps; i++) {
    tick(state, world);
    hearts += state.events.filter((e) => e === "heart").length;
  }
  if (hearts) heart();
  if (state.mode === "home") {
    // he went inside: hide him and let the loop sleep until he is called out
    setHome(true);
    running = false;
    return;
  }
  // frames with no tick keep the previous answer, so legs don't freeze on high refresh displays
  if (steps > 0) legsMoving = state.walk !== walkBefore;
  snore(now);
  // off screen he keeps thinking at full rate (ticks are cheap) but skips drawing, the expensive part;
  // a slower poll here made him freeze and then pop back when he reappeared
  if (!isOffscreen()) draw();
  requestAnimationFrame(frame);
}

function run(): void {
  if (running || document.hidden || state.mode === "home") return;
  running = true;
  lastFrame = 0; // don't replay the time spent hidden
  requestAnimationFrame(frame);
}

function stop(): void {
  running = false;
}

// only olex's opaque pixels take the pointer, so links under his empty corners stay clickable
function trackCursor(e: PointerEvent): void {
  if (e.pointerType !== "mouse") return;
  const c = world.cursor;
  if (!c || Math.hypot(e.pageX - c.x, e.pageY - c.y) > 2) world.cursor = { x: e.pageX, y: e.pageY, stillSince: performance.now() };
}

const onOlex = (x: number, y: number) => opaqueAt({ out: lastOut, W: BUFFER.W, H: BUFFER.H, origin, scale: SCALE }, x, y);

function hitTest(e: PointerEvent): void {
  // never drop pointer capture mid-gesture
  if (input.active()) return;
  const hit = onOlex(e.pageX, e.pageY);
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
  tagCounts = document.getElementById("olex-tag-counts")!;
  updateTag();
  void pets.loadTotal().then(updateTag);
  // batched pets go out every few seconds, and whatever is left when the page goes away
  setInterval(() => void pets.flush().then(updateTag), 1000);
  addEventListener("pagehide", () => pets.onPageHide());
  build();
  world = {
    plats: [] as Platform[], view: view(), now: performance.now(), reducedMotion: reduced.matches, paused: false,
    rand: Math.random,
    scruff: (yaw) => {
      const [x, y] = scruffOffset(yaw);
      return [x * SCALE, y * SCALE];
    },
    cursor: null,
    hover: false,
    bounds: { left: 0, right: document.documentElement.scrollWidth },
    house: null,
  };
  remeasure();
  state = initState(world);
  const saved = store.getSession();
  if (store.getHome() && world.house) {
    runCommand(state, "go home", { ...world, reducedMotion: true }); // straight inside, no walk
  } else if (saved) {
    // a full reload: put him back where he was on screen and let him land
    state.x = saved.x;
    state.y = scrollY + saved.vy;
    state.dir = saved.dir;
    onPageSwap(state, world);
  }
  addEventListener("pagehide", () => store.setSession({ x: state.x, vy: state.y - scrollY, dir: state.dir }));
  // dev only: lets manual checks poke at his state from the console
  if (import.meta.env.DEV) Object.assign(window, { __olex: { state, world } });

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
    if (state.mode === "home") runCommand(state, "go home", { ...world, reducedMotion: true }); // the house moved with the new page
    else onPageSwap(state, world);
  });
  // delegated, because the footer is replaced on every navigation
  document.addEventListener("click", (e) => {
    if ((e.target as Element | null)?.closest("#olex-house")) callOutOfHouse();
  });
  document.addEventListener("pointermove", hitTest, { passive: true });
  document.addEventListener("pointermove", trackCursor, { passive: true });
  document.documentElement.addEventListener("pointerleave", () => (world.cursor = null));
  input = attachInput(canvas, onGesture);
  // touch has no hover, so the canvas is never enabled ahead of a tap: catch presses on his pixels here first
  document.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" || e.target === canvas || canvas.style.visibility === "hidden") return;
    if (!onOlex(e.pageX, e.pageY)) return;
    e.stopPropagation(); // the page under him should not see this press
    canvas.style.pointerEvents = "auto";
    input.begin(e);
  }, { capture: true });
  // and stop that touch from scrolling the page or turning into a click on whatever is under him
  document.addEventListener("touchstart", (e) => {
    const t = e.touches[0];
    if (t && canvas.style.visibility !== "hidden" && onOlex(t.pageX, t.pageY)) e.preventDefault();
  }, { passive: false });
  document.addEventListener("pointerdown", (e) => {
    if (e.target !== canvas) clickAnywhere(state, world);
  });
  attachThrow({
    armed: () => state.fetch?.phase === "wait",
    olex: canvas,
    onHold: (at) => (heldBall = at),
    onThrow: (b) => throwBall(state, b, world),
    onEnd: () => endFetch(state),
  });
  document.addEventListener("visibilitychange", () => (document.hidden ? stop() : run()));
  if (state.mode === "home") setHome(true);
  run();
}
