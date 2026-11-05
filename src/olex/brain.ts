// Olex's behavior: a pure state machine advanced once per frame.

import type { Pose } from "./model";
import { hopPos, stepFall, type Hop } from "./physics";
import { landingCrossed, nearestVisible, platformUnder, reachable, type Platform, type View } from "./world";

export type Mode =
  | "walk" | "turn" | "hop" | "idle" | "fall" | "carried" | "pet"
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
  hop: (Hop & { to: number }) | null;
  fallV: number;
  pose: Pose;
  poseT: number;
  timer: number;        // ticks left in the current timed behavior
  lastInteraction: number;
  offscreenSince: number | null;
};

export type World = {
  plats: Platform[];
  view: View;
  now: number;          // ms
  reducedMotion: boolean;
  paused: boolean;      // e.g. while text is selected
  rand: () => number;
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

export const facingYaw = (dir: 1 | -1) => (dir > 0 ? 0 : Math.PI);

export function initState(w: World): State {
  const plat = Math.max(0, nearestVisible(w.plats, w.view));
  const p = w.plats[plat];
  return {
    mode: "walk", x: p ? Math.min(p.x1 + 40, p.x2 - EDGE) : 0, y: p?.y ?? 0, plat, dir: 1,
    yaw: 0, targetYaw: 0, walk: 0, hop: null, fallV: 0, pose: "stand", poseT: 0, timer: 0,
    lastInteraction: w.now, offscreenSince: null,
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
  if (!off || s.mode === "fall") {
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

  const grounded = s.mode === "walk" || s.mode === "turn" || s.mode === "idle";
  if (grounded && !supported(s, w)) startFall(s);

  switch (s.mode) {
    case "walk":
      stepWalk(s, w);
      break;
    case "turn":
      if (Math.abs(s.targetYaw - s.yaw) < 0.01) s.mode = "walk";
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
        s.mode = "walk";
      }
      break;
    }
    case "fall":
      stepFallMode(s, w);
      break;
  }
}
