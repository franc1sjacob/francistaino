// Olex's behavior: a pure state machine advanced once per frame.

import type { Pose } from "./model";
import type { Gesture } from "./input";
import { hopPos, stepFall, stepPendulum, type Hop } from "./physics";
import { landingCrossed, nearestVisible, platformUnder, reachable, type Platform, type View } from "./world";

export type Mode =
  | "walk" | "turn" | "hop" | "idle" | "fall" | "carried" | "drop" | "shake" | "pet" | "spin"
  | "command" | "fetch" | "home" | "goingHome";

export type State = {
  mode: Mode;
  x: number;            // body centre, document px
  y: number;            // feet, document px
  plat: number;         // platform index he stands on
  dir: 1 | -1;          // walking direction
  yaw: number;
  targetYaw: number;
  walk: number;         // walk cycle phase
  hop: (Hop & { to: number; then?: Mode }) | null;
  fallV: number;
  pose: Pose;
  poseT: number;
  timer: number;        // ticks left in the current timed behavior
  lastInteraction: number;
  offscreenSince: number | null;
  swingA: number;       // carried tilt around the scruff
  swingV: number;
  pivot: { x: number; y: number };             // scruff position while carried or dropped
  pointer: { x: number; y: number; vx: number };
  pets: number[];       // recent pet times, for the spin trick
};

export type World = {
  plats: Platform[];
  view: View;
  now: number;          // ms
  reducedMotion: boolean;
  paused: boolean;      // e.g. while text is selected
  rand: () => number;
  scruff: (yaw: number) => [number, number];   // scruff offset from his feet in page px (x, up)
};

const SPEED = 0.9;
const WALK_RATE = 0.03;
const YAW_STEP = 0.12;
const EDGE = 11;          // how far his centre may go from a platform end
const MAX_CLIMB = 80;     // px, about three lines
const HOP_TICKS = 30;
const HOP_HEIGHT = 26;
const SNAP = 12;          // tolerance when platforms shift after a re-measure
const OFFSCREEN_MS = 10_000;
const DOG_HEIGHT = 50;
const CARRY_REST = 1.15;  // hang tail-down at this tilt
const SHAKE_TICKS = 36;
const PET_TICKS = 90;
const SPIN_TICKS = 42;
const SPIN_RATE = 0.3;
const PETS_FOR_TRICK = 4;
const PET_WINDOW_MS = 3000;
const TAU = Math.PI * 2;

export const facingYaw = (dir: 1 | -1) => (dir > 0 ? 0 : Math.PI);

export function initState(w: World): State {
  const plat = Math.max(0, nearestVisible(w.plats, w.view));
  const p = w.plats[plat];
  return {
    mode: "walk", x: p ? Math.min(p.x1 + 40, p.x2 - EDGE) : 0, y: p?.y ?? 0, plat, dir: 1,
    yaw: 0, targetYaw: 0, walk: 0, hop: null, fallV: 0, pose: "stand", poseT: 0, timer: 0,
    lastInteraction: w.now, offscreenSince: null,
    swingA: 0, swingV: 0, pivot: { x: 0, y: 0 }, pointer: { x: 0, y: 0, vx: 0 }, pets: [],
  };
}

const spans = (p: Platform, x: number) => x >= p.x1 - EDGE && x <= p.x2 + EDGE;

// keeps him attached to his platform across re-measures; false if nothing holds him up
function supported(s: State, w: World): boolean {
  const p = w.plats[s.plat];
  if (p && Math.abs(p.y - s.y) <= SNAP && spans(p, s.x)) {
    s.y = p.y;
    return true;
  }
  const i = w.plats.findIndex((q) => Math.abs(q.y - s.y) <= SNAP && spans(q, s.x));
  if (i < 0) return false;
  s.plat = i;
  s.y = w.plats[i].y;
  return true;
}

export function startFall(s: State): void {
  s.mode = "fall";
  s.fallV = 0;
  s.hop = null;
}

function easeYaw(s: State): void {
  const d = s.targetYaw - s.yaw;
  s.yaw += Math.sign(d) * Math.min(Math.abs(d), YAW_STEP);
}

function startHop(s: State, w: World, to: number): void {
  const t = w.plats[to];
  const tx = Math.min(Math.max(s.x, t.x1 + EDGE), t.x2 - EDGE);
  s.hop = { fx: s.x, fy: s.y, tx, ty: t.y, t: 0, dur: HOP_TICKS, h: HOP_HEIGHT, to };
  s.mode = "hop";
}

function turnAround(s: State): void {
  s.dir = s.dir > 0 ? -1 : 1;
  s.targetYaw = facingYaw(s.dir);
  s.mode = "turn";
}

function stepWalk(s: State, w: World): void {
  if (w.paused) return;
  const p = w.plats[s.plat];
  s.x += s.dir * SPEED;
  s.walk += WALK_RATE;
  const atEdge = s.dir > 0 ? s.x > p.x2 - EDGE : s.x < p.x1 + EDGE;
  if (!atEdge) return;
  s.x = Math.min(Math.max(s.x, p.x1 + EDGE), p.x2 - EDGE);
  const targets = reachable(w.plats, s.plat, MAX_CLIMB);
  if (targets.length && w.rand() < 0.5) startHop(s, w, targets[Math.floor(w.rand() * targets.length)]);
  else turnAround(s);
}

function stepFallMode(s: State, w: World): void {
  const prevY = s.y;
  const f = { y: s.y, v: s.fallV };
  stepFall(f);
  s.y = f.y;
  s.fallV = f.v;
  const hit = landingCrossed(w.plats, s.x, prevY, s.y);
  if (hit >= 0) {
    s.plat = hit;
    s.y = w.plats[hit].y;
    s.mode = "walk";
    s.targetYaw = facingYaw(s.dir);
  } else if (s.y > w.view.bottom + 3000) {
    dropIn(s, w); // fell off the world somehow
  }
}

// drop back into view onto a visible platform
function dropIn(s: State, w: World): void {
  const to = nearestVisible(w.plats, w.view);
  if (to < 0) return;
  const p = w.plats[to];
  s.x = Math.min(Math.max(s.x, p.x1 + EDGE), p.x2 - EDGE);
  s.y = w.view.top - DOG_HEIGHT;
  s.offscreenSince = null;
  startFall(s);
}

// a new page was swapped in under him: fall onto what is below if it is on screen, else drop into view
export function onPageSwap(s: State, w: World): void {
  const under = platformUnder(w.plats, s.x, s.y);
  if (under >= 0 && w.plats[under].y <= w.view.bottom - DOG_HEIGHT) startFall(s);
  else dropIn(s, w);
}

function trackOffscreen(s: State, w: World): void {
  const off = s.y < w.view.top || s.y - DOG_HEIGHT > w.view.bottom;
  if (!off || s.mode === "fall" || s.mode === "carried" || s.mode === "drop") {
    s.offscreenSince = null;
    return;
  }
  s.offscreenSince ??= w.now;
  if (w.now - s.offscreenSince > OFFSCREEN_MS) dropIn(s, w);
}

export function tick(s: State, w: World): void {
  easeYaw(s);
  trackOffscreen(s, w);

  if (w.reducedMotion && (s.mode === "walk" || s.mode === "turn" || s.mode === "hop")) {
    s.mode = "idle";
    s.hop = null;
    s.pose = "sit";
    s.poseT = 1;
  }

  const grounded = ["walk", "turn", "idle", "pet", "shake", "spin"].includes(s.mode);
  if (grounded && !supported(s, w)) startFall(s);

  switch (s.mode) {
    case "walk":
      stepWalk(s, w);
      break;
    case "turn":
      if (Math.abs(s.targetYaw - s.yaw) < 0.01) {
        s.yaw = s.targetYaw = facingYaw(s.dir);
        s.mode = "walk";
      }
      break;
    case "hop": {
      const h = s.hop!;
      h.t++;
      s.walk += WALK_RATE;
      const pos = hopPos(h);
      s.x = pos.x;
      s.y = pos.y;
      if (pos.done) {
        s.plat = h.to;
        s.hop = null;
        s.mode = h.then ?? "walk";
        if (s.mode === "shake") s.timer = SHAKE_TICKS;
      }
      break;
    }
    case "carried":
      stepCarried(s, w);
      break;
    case "drop":
      stepDrop(s, w);
      break;
    case "shake":
      // shake it off, then carry on the way he was facing
      s.targetYaw = facingYaw(s.dir) + Math.sin(s.timer * 1.3) * 0.35 * (s.timer / SHAKE_TICKS);
      if (--s.timer <= 0) turnTo(s, facingYaw(s.dir));
      break;
    case "pet":
      if (--s.timer <= 0) turnTo(s, facingYaw(s.dir));
      break;
    case "spin":
      s.yaw += SPIN_RATE;
      s.targetYaw = s.yaw;
      if (--s.timer <= 0) {
        s.yaw = ((s.yaw % TAU) + TAU) % TAU;
        const f = facingYaw(s.dir);
        // finish the turn the short way round
        turnTo(s, f === 0 && s.yaw > Math.PI ? TAU : f);
      }
      break;
    case "fall":
      stepFallMode(s, w);
      break;
  }
}

function turnTo(s: State, yaw: number): void {
  s.targetYaw = yaw;
  s.mode = "turn";
}

function feetFromPivot(s: State, w: World): void {
  const [sx, sy] = w.scruff(s.yaw);
  s.x = s.pivot.x - sx;
  s.y = s.pivot.y + sy;
}

function stepCarried(s: State, w: World): void {
  s.pivot.x += (s.pointer.x - s.pivot.x) * 0.5;
  s.pivot.y += (s.pointer.y - s.pivot.y) * 0.5;
  const sw = { a: s.swingA, v: s.swingV };
  stepPendulum(sw, CARRY_REST * Math.cos(s.yaw), s.pointer.vx);
  s.swingA = sw.a;
  s.swingV = sw.v;
  s.pointer.vx *= 0.6;
  s.walk += 0.06; // paddling
  feetFromPivot(s, w);
}

function stepDrop(s: State, w: World): void {
  // right himself while dropping
  const sw = { a: s.swingA, v: s.swingV };
  stepPendulum(sw, 0, 0);
  s.swingA = sw.a * 0.85;
  s.swingV = sw.v;
  const prevY = s.y;
  s.fallV = Math.min(s.fallV + 0.6, 14);
  s.pivot.y += s.fallV;
  feetFromPivot(s, w);
  const hit = landingCrossed(w.plats, s.x, prevY, s.y);
  if (hit >= 0) {
    const y = w.plats[hit].y;
    s.y = y;
    s.plat = hit;
    s.swingA = s.swingV = 0;
    s.hop = { fx: s.x, fy: y, tx: s.x, ty: y, t: 0, dur: 14, h: Math.min(10, s.fallV), to: hit, then: "shake" };
    s.mode = "hop";
  } else if (s.y > w.view.bottom + 3000) {
    s.swingA = 0;
    dropIn(s, w);
  }
}

const canBePetted = (m: Mode) => ["walk", "turn", "idle", "pet", "shake"].includes(m);

export function handle(s: State, g: Gesture, w: World): void {
  s.lastInteraction = w.now;
  switch (g.kind) {
    case "pet": {
      if (!canBePetted(s.mode)) return;
      s.pets = [...s.pets.filter((t) => w.now - t < PET_WINDOW_MS), w.now];
      if (s.pets.length >= PETS_FOR_TRICK) {
        s.pets = [];
        s.mode = "spin";
        s.timer = SPIN_TICKS;
        return;
      }
      s.mode = "pet";
      s.timer = PET_TICKS;
      s.targetYaw = Math.PI / 2;
      return;
    }
    case "dragStart": {
      if (s.mode === "carried") return;
      const [sx, sy] = w.scruff(s.yaw);
      s.pivot = { x: s.x + sx, y: s.y - sy };
      s.pointer = { x: g.x, y: g.y, vx: 0 };
      s.swingA = s.swingV = 0;
      s.hop = null;
      s.mode = "carried";
      // turn a little toward you while dangling
      s.targetYaw = s.dir > 0 ? 0.45 : Math.PI - 0.45;
      return;
    }
    case "dragMove":
      if (s.mode !== "carried") return;
      s.pointer = { x: g.x, y: g.y, vx: g.vx };
      return;
    case "dragEnd":
      if (s.mode !== "carried") return;
      s.mode = "drop";
      s.fallV = 0;
      return;
    case "menu":
      return; // menu arrives in task 7
  }
}
