// Olex's behavior: a pure state machine advanced once per frame.

import type { Pose } from "./model";
import type { Gesture } from "./input";
import type { Command } from "./menu";
import { hopPos, stepBall, stepFall, stepPendulum, type Ball, type Hop } from "./physics";
import { landingCrossed, nearestVisible, platformUnder, reachable, type Platform, type View } from "./world";

export type Mode =
  | "walk" | "turn" | "hop" | "idle" | "fall" | "carried" | "drop" | "shake" | "pet" | "spin"
  | "command" | "fetch" | "home" | "goingHome" | "comingOut";

export type Idle = "sit" | "scratch" | "yawn" | "nap" | "notice";
export type Cmd = "sit" | "roll" | "treat" | "follow" | "zoomies" | "flop";
export type Event = "heart";

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
  idle: Idle | null;    // current idle behavior while mode is "idle"
  lastIdle: Idle | null;
  nextIdleAt: number;
  noticeCooldown: number;
  poseGoal: Pose;       // pose he is easing toward
  phase: number;        // scratch phase
  wag: number | null;   // tail wag phase, null when still
  cmd: Cmd | null;      // active menu command while mode is "command"
  treat: { x: number } | null;
  events: Event[];      // one-shot effects for the page to show, cleared each tick
  fetch: { phase: "wait" | "chase" | "carry"; ball: Ball | null; home: { x: number; y: number } } | null;
  after: Mode | null;   // mode to resume after landing from a fall
};

export type World = {
  plats: Platform[];
  view: View;
  now: number;          // ms
  reducedMotion: boolean;
  paused: boolean;      // e.g. while text is selected
  rand: () => number;
  scruff: (yaw: number) => [number, number];   // scruff offset from his feet in page px (x, up)
  cursor: { x: number; y: number; stillSince: number } | null;
  hover: boolean;
  bounds: { left: number; right: number };    // page edges the ball bounces off
  house: { x1: number; x2: number; y: number } | null;  // his doghouse, standing on the floor
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
const IDLE_EVERY_MS = 8000;      // plus up to the same again, at random
const NAP_AFTER_MS = 30_000;
const NOTICE_STILL_MS = 1000;
const NOTICE_RANGE = 200;
const NOTICE_COOLDOWN_MS = 8000;
const POSE_RATE = 0.08;
const IDLES: Idle[] = ["sit", "scratch", "yawn"];

export const facingYaw = (dir: 1 | -1) => (dir > 0 ? 0 : Math.PI);

export function initState(w: World): State {
  const plat = Math.max(0, nearestVisible(w.plats, w.view));
  const p = w.plats[plat];
  return {
    mode: "walk", x: p ? Math.min(p.x1 + 40, p.x2 - EDGE) : 0, y: p?.y ?? 0, plat, dir: 1,
    yaw: 0, targetYaw: 0, walk: 0, hop: null, fallV: 0, pose: "stand", poseT: 0, timer: 0,
    lastInteraction: w.now, offscreenSince: null,
    swingA: 0, swingV: 0, pivot: { x: 0, y: 0 }, pointer: { x: 0, y: 0, vx: 0 }, pets: [],
    idle: null, lastIdle: null, nextIdleAt: w.now + IDLE_EVERY_MS, noticeCooldown: 0,
    poseGoal: "stand", phase: 0, wag: null, cmd: null, treat: null, events: [], fetch: null, after: null,
  };
}

const spans = (p: Platform, x: number) => x >= p.x1 - EDGE && x <= p.x2 + EDGE;

// modes worth resuming after a fall caused by the page moving under him
const resumable = (m: Mode): Mode | null => (m === "command" || m === "fetch" || m === "goingHome" ? m : null);

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

export function startFall(s: State, after: Mode | null = null): void {
  s.mode = "fall";
  s.fallV = 0;
  s.hop = null;
  s.after = after;
}

function easeYaw(s: State): void {
  const d = s.targetYaw - s.yaw;
  s.yaw += Math.sign(d) * Math.min(Math.abs(d), YAW_STEP);
}

const MAX_HOP_DROP = 160;

function startHop(s: State, w: World, to: number, o: { dur?: number; h?: number; then?: Mode } = {}): void {
  const t = w.plats[to];
  const tx = Math.min(Math.max(s.x, t.x1 + EDGE), t.x2 - EDGE);
  if (t.y - s.y > MAX_HOP_DROP) {
    // too far down to hop: step off the edge he is facing and fall for real
    const here = w.plats[s.plat];
    if (here) s.x = s.dir > 0 ? here.x2 + 2 : here.x1 - 2;
    startFall(s, o.then ?? null);
    return;
  }
  s.hop = { fx: s.x, fy: s.y, tx, ty: t.y, t: 0, dur: o.dur ?? HOP_TICKS, h: o.h ?? HOP_HEIGHT, to, then: o.then };
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
    s.mode = s.after ?? "walk";
    s.after = null;
    // whatever he was doing did not survive the fall
    if (s.mode !== "fetch") s.fetch = null;
    if (s.mode !== "command") {
      s.cmd = null;
      s.treat = null;
    }
    if (s.mode === "walk") s.targetYaw = facingYaw(s.dir);
  } else if (s.y > w.view.bottom + 3000 || platformUnder(w.plats, s.x, s.y) < 0) {
    dropIn(s, w); // nothing below to land on
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
  startFall(s, s.mode === "fall" ? s.after : resumable(s.mode));
}

// a new page was swapped in under him: fall onto what is below if it is on screen, else drop into view
export function onPageSwap(s: State, w: World): void {
  const under = platformUnder(w.plats, s.x, s.y);
  if (under >= 0 && w.plats[under].y <= w.view.bottom - DOG_HEIGHT) startFall(s, resumable(s.mode));
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
  s.events = [];
  if (s.mode === "home") return; // inside the house: nothing to do
  easeYaw(s);
  trackOffscreen(s, w);

  if (w.reducedMotion && (s.mode === "walk" || s.mode === "turn" || s.mode === "hop")) {
    s.mode = "idle";
    s.hop = null;
    s.pose = s.poseGoal = "sit";
    s.poseT = 1;
  }
  stepPose(s);
  s.wag = w.hover || s.mode === "pet" ? (s.wag ?? 0) + 0.5 : null;
  if (!w.reducedMotion) {
    const restful = s.mode === "walk" || s.mode === "turn" || s.mode === "idle";
    if (restful && s.idle !== "nap" && w.now - s.lastInteraction > NAP_AFTER_MS) startIdle(s, w, "nap");
    if (s.mode === "walk" && noticesCursor(s, w)) startIdle(s, w, "notice");
    else if (s.mode === "walk" && w.now >= s.nextIdleAt) startIdle(s, w, pickIdle(s, w.rand));
  }

  const grounded = ["walk", "turn", "idle", "pet", "shake", "spin", "command", "fetch", "goingHome", "comingOut"].includes(s.mode);
  if (grounded && !supported(s, w)) startFall(s, resumable(s.mode));

  switch (s.mode) {
    case "walk":
      stepWalk(s, w);
      break;
    case "idle":
      stepIdle(s, w);
      break;
    case "command":
      stepCommand(s, w);
      break;
    case "fetch":
      stepFetch(s, w);
      break;
    case "goingHome":
      stepGoingHome(s, w);
      break;
    case "comingOut":
      s.x -= SPEED * 1.2;
      s.walk += WALK_RATE * 1.2;
      if (w.house && s.x < w.house.x1 - 20) s.mode = "walk";
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
  // reduced motion: carried without swinging
  s.swingA = w.reducedMotion ? 0 : sw.a;
  s.swingV = w.reducedMotion ? 0 : sw.v;
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
  } else if (s.y > w.view.bottom + 3000 || platformUnder(w.plats, s.x, s.y) < 0) {
    // dropped where there is nothing to land on (outside the column): come back into view
    s.swingA = s.swingV = 0;
    dropIn(s, w);
  }
}

const canBePetted = (m: Mode) => ["walk", "turn", "idle", "pet", "shake", "command", "fetch"].includes(m);

export function handle(s: State, g: Gesture, w: World): void {
  s.lastInteraction = w.now;
  // any attention ends whatever he was idly doing (including a nap) or was told to do
  if (g.kind !== "dragMove" && s.cmd) endCommand(s);
  if (g.kind !== "dragMove" && s.fetch) endFetch(s);
  if (s.idle) {
    s.idle = null;
    s.poseGoal = "stand";
    s.nextIdleAt = w.now + IDLE_EVERY_MS;
  }
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

export function pickIdle(s: State, rand: () => number): Idle {
  const options = IDLES.filter((i) => i !== s.lastIdle);
  const idle = options[Math.min(options.length - 1, Math.floor(rand() * options.length))];
  s.lastIdle = idle;
  return idle;
}

function stepPose(s: State): void {
  if (s.pose !== s.poseGoal) {
    // ease out of the old pose before easing into the new one
    if (s.pose === "stand" || s.poseT <= 0) {
      s.pose = s.poseGoal;
      s.poseT = 0;
    } else s.poseT = Math.max(0, s.poseT - POSE_RATE);
  } else if (s.pose !== "stand") s.poseT = Math.min(1, s.poseT + POSE_RATE);
}

function noticesCursor(s: State, w: World): boolean {
  const c = w.cursor;
  if (!c || w.now < s.noticeCooldown || w.now - c.stillSince < NOTICE_STILL_MS) return false;
  return Math.hypot(c.x - s.x, c.y - (s.y - 20)) <= NOTICE_RANGE;
}

function startIdle(s: State, w: World, idle: Idle): void {
  s.mode = "idle";
  s.idle = idle;
  s.hop = null;
  s.phase = 0;
  switch (idle) {
    case "sit":
      s.poseGoal = "sit";
      s.timer = 180 + Math.floor(w.rand() * 120);
      break;
    case "scratch":
      s.poseGoal = "sit";
      s.timer = 120;
      break;
    case "yawn":
      s.targetYaw = Math.PI / 2;
      s.timer = 90;
      break;
    case "nap":
      s.poseGoal = "curl";
      s.timer = Infinity;
      break;
    case "notice":
      s.timer = 180;
      break;
  }
}

function endIdle(s: State, w: World): void {
  if (s.idle === "notice") s.noticeCooldown = w.now + NOTICE_COOLDOWN_MS;
  s.idle = null;
  s.poseGoal = "stand";
  s.nextIdleAt = w.now + IDLE_EVERY_MS * (1 + w.rand());
  turnTo(s, facingYaw(s.dir));
}

function stepIdle(s: State, w: World): void {
  if (!s.idle) return; // reduced motion: just sit
  if (s.idle === "nap") return;
  if (s.idle === "scratch") s.phase += 0.6;
  if (s.idle === "notice") {
    const c = w.cursor;
    if (!c) return endIdle(s, w);
    const p = w.plats[s.plat];
    const dx = c.x - s.x;
    const blocked = dx > 0 ? s.x >= p.x2 - EDGE : s.x <= p.x1 + EDGE;
    if (Math.abs(dx) > 30 && !blocked) {
      // trot over
      s.dir = dx > 0 ? 1 : -1;
      s.targetYaw = facingYaw(s.dir);
      s.x += s.dir * SPEED * 1.4;
      s.walk += WALK_RATE * 1.5;
      return;
    }
    // arrived: sit and look up at you
    s.targetYaw = Math.PI / 2;
    s.poseGoal = "sit";
  }
  if (--s.timer <= 0) endIdle(s, w);
}

const ZOOMIES_TICKS = 375;   // about 6s
const ZOOMIES_SPEED = 4.5;
const FLOP_TICKS = 150;
const ROLL_TICKS = 140;
const EAT_TICKS = 90;
const FOLLOW_SPEED = 1.4;

function endCommand(s: State): void {
  s.cmd = null;
  s.treat = null;
  s.poseGoal = "stand";
  if (s.mode === "command") turnTo(s, facingYaw(s.dir));
}

function startCommand(s: State, cmd: Cmd, timer = Infinity): void {
  s.idle = null;
  s.hop = null;
  s.mode = "command";
  s.cmd = cmd;
  s.timer = timer;
}

const ENERGETIC: Command[] = ["zoomies", "spin", "roll over", "follow me"];

export function runCommand(s: State, c: Command, w: World): void {
  s.lastInteraction = w.now;
  if (w.reducedMotion && ENERGETIC.includes(c)) c = "sit"; // calm stand-in for big motion
  if (s.cmd) endCommand(s);
  if (s.fetch) endFetch(s);
  s.idle = null;
  switch (c) {
    case "sit":
      startCommand(s, "sit");
      s.poseGoal = "sit";
      s.targetYaw = Math.PI / 2;
      break;
    case "roll over":
      startCommand(s, "roll", ROLL_TICKS);
      s.poseGoal = "lie";
      break;
    case "spin":
      s.mode = "spin";
      s.timer = SPIN_TICKS;
      break;
    case "treat": {
      const p = w.plats[s.plat];
      const x = Math.min(Math.max(s.x + s.dir * 40, p.x1 + EDGE), p.x2 - EDGE);
      startCommand(s, "treat");
      s.treat = { x };
      break;
    }
    case "nap":
      startIdle(s, w, "nap");
      break;
    case "follow me":
      startCommand(s, "follow");
      break;
    case "zoomies":
      startCommand(s, "zoomies", ZOOMIES_TICKS);
      break;
    case "fetch":
      s.idle = null;
      s.hop = null;
      s.mode = "fetch";
      s.fetch = { phase: "wait", ball: null, home: { x: s.x, y: s.y } };
      s.targetYaw = Math.PI / 2;
      break;
    case "go home":
      goHome(s, w);
      break;
  }
}

// a click anywhere on the page ends "follow me"
export function clickAnywhere(s: State, _w: World): void {
  if (s.cmd === "follow") endCommand(s);
}

// walk toward x on the current platform; true once there (or blocked by the edge)
function walkToward(s: State, w: World, x: number, speed: number, near: number): boolean {
  const p = w.plats[s.plat];
  const dx = x - s.x;
  if (Math.abs(dx) <= near) return true;
  s.dir = dx > 0 ? 1 : -1;
  s.targetYaw = facingYaw(s.dir);
  const next = s.x + s.dir * Math.min(speed, Math.abs(dx));
  if (next < p.x1 + EDGE || next > p.x2 - EDGE) return true;
  s.x = next;
  s.walk += WALK_RATE * (speed / SPEED);
  return false;
}

function stepCommand(s: State, w: World): void {
  switch (s.cmd) {
    case "sit":
      return; // stays until petted or told otherwise
    case "roll":
      s.wag = (s.wag ?? 0) + 0.5;
      if (--s.timer <= 0) endCommand(s);
      return;
    case "treat": {
      if (!s.treat) return endCommand(s);
      if (!walkToward(s, w, s.treat.x, SPEED, 6)) return;
      if (s.timer === Infinity) {
        s.timer = EAT_TICKS;
        s.targetYaw = Math.PI / 2;
      }
      if (--s.timer <= 0) {
        s.events.push("heart");
        endCommand(s);
      }
      return;
    }
    case "follow": {
      const c = w.cursor;
      if (!c) return;
      const arrived = walkToward(s, w, c.x, FOLLOW_SPEED, 20);
      if (arrived && Math.abs(c.x - s.x) > 20) {
        // at an edge: hop to the platform that gets him closest to the cursor
        const best = reachable(w.plats, s.plat, MAX_CLIMB).sort((a, b) => dist(w.plats[a], c) - dist(w.plats[b], c))[0];
        if (best !== undefined && dist(w.plats[best], c) < dist(w.plats[s.plat], c)) startHop(s, w, best, { then: "command" });
      }
      return;
    }
    case "zoomies": {
      if (--s.timer <= 0) {
        s.cmd = "flop";
        s.timer = FLOP_TICKS;
        s.poseGoal = "lie";
        return;
      }
      const p = w.plats[s.plat];
      s.x += s.dir * ZOOMIES_SPEED;
      s.walk += WALK_RATE * 3;
      const atEdge = s.dir > 0 ? s.x > p.x2 - EDGE : s.x < p.x1 + EDGE;
      if (!atEdge) return;
      s.x = Math.min(Math.max(s.x, p.x1 + EDGE), p.x2 - EDGE);
      const targets = reachable(w.plats, s.plat, MAX_CLIMB);
      if (targets.length && w.rand() < 0.6) {
        startHop(s, w, targets[Math.floor(w.rand() * targets.length)], { dur: 18, h: 34, then: "command" });
      } else {
        // whip around instantly
        s.dir = s.dir > 0 ? -1 : 1;
        s.yaw = s.targetYaw = facingYaw(s.dir);
      }
      return;
    }
    case "flop":
      if (--s.timer <= 0) endCommand(s);
      return;
  }
}

function dist(p: Platform, c: { x: number; y: number }): number {
  const x = Math.min(Math.max(c.x, p.x1), p.x2);
  return Math.hypot(c.x - x, c.y - p.y);
}

const CHASE_SPEED = 2.4;
const LEAP = { dur: 40, h: 60 };

// the ball left the cursor: chase it
export function throwBall(s: State, ball: Ball, w: World): void {
  if (!s.fetch) return;
  s.lastInteraction = w.now;
  s.fetch.ball = { ...ball };
  s.fetch.home = w.cursor ? { x: w.cursor.x, y: w.cursor.y } : { x: ball.x, y: ball.y };
  s.fetch.phase = "chase";
}

export function endFetch(s: State): void {
  if (!s.fetch) return;
  s.fetch = null;
  if (s.mode === "fetch") turnTo(s, facingYaw(s.dir));
}

// head for point p across platforms: walk on this one, hop toward it, or leap if nothing is reachable.
// true once he stands next to it.
function goTo(s: State, w: World, p: { x: number; y: number }, near: number, leap: boolean, speed = CHASE_SPEED): boolean {
  const target = platformUnder(w.plats, p.x, p.y - 1);
  if (target === s.plat || target < 0) return walkToward(s, w, p.x, speed, near);
  if (!walkToward(s, w, p.x, speed, near)) return false;
  // at the edge (or under it): find a platform that gets closer
  const then = s.mode;
  const here = dist(w.plats[s.plat], p);
  const best = reachable(w.plats, s.plat, MAX_CLIMB).sort((a, b) => dist(w.plats[a], p) - dist(w.plats[b], p))[0];
  if (best !== undefined && dist(w.plats[best], p) < here) startHop(s, w, best, { then });
  else if (leap) startHop(s, w, target, { ...LEAP, then });
  return false;
}

function stepFetch(s: State, w: World): void {
  const f = s.fetch;
  if (!f) return void turnTo(s, facingYaw(s.dir));
  s.wag = (s.wag ?? 0) + 0.5;
  if (f.phase === "wait") {
    s.targetYaw = Math.PI / 2;
    return;
  }
  if (f.phase === "chase" && f.ball) {
    stepBall(f.ball, w.plats, w.bounds);
    const b = f.ball;
    if (b.y > w.view.bottom + 1500) {
      // lost off the page: it comes back to your hand
      f.ball = null;
      f.phase = "wait";
      return;
    }
    const arrived = goTo(s, w, b, 8, b.resting);
    if (arrived && b.resting && Math.abs(b.x - s.x) <= 12) {
      f.ball = null;
      f.phase = "carry";
    }
    return;
  }
  if (f.phase === "carry") {
    const home = w.cursor ?? f.home;
    if (goTo(s, w, home, 24, true)) {
      // drop it at your feet and look up, ready for another throw
      f.phase = "wait";
      s.targetYaw = Math.PI / 2;
    }
  }
}

const DASH_DISTANCE = 700;

const door = (h: NonNullable<World["house"]>) => ({ x: (h.x1 + h.x2) / 2, y: h.y });

function enterHome(s: State, w: World): void {
  const h = w.house!;
  const d = door(h);
  s.x = d.x;
  s.y = d.y;
  s.plat = platformUnder(w.plats, d.x, d.y - 1);
  s.hop = null;
  s.mode = "home";
}

function goHome(s: State, w: World): void {
  if (!w.house) return;
  s.idle = null;
  s.poseGoal = "stand";
  if (w.reducedMotion) return enterHome(s, w);
  s.mode = "goingHome";
}

function stepGoingHome(s: State, w: World): void {
  if (!w.house) return turnTo(s, facingYaw(s.dir));
  const d = door(w.house);
  // a long way from home: dash there like zoomies so it never takes long
  const speed = Math.hypot(d.x - s.x, d.y - s.y) > DASH_DISTANCE ? ZOOMIES_SPEED : CHASE_SPEED;
  if (goTo(s, w, d, 3, true, speed)) enterHome(s, w);
}

// clicking the house or the nav toggle brings him back out
export function callOut(s: State, w: World): void {
  if (s.mode !== "home" || !w.house) return;
  const d = door(w.house);
  s.lastInteraction = w.now;
  s.x = d.x;
  s.y = d.y;
  s.plat = Math.max(0, platformUnder(w.plats, d.x, d.y - 1));
  s.dir = -1;
  s.yaw = s.targetYaw = Math.PI;
  if (w.reducedMotion) {
    s.x = w.house.x1 - 30;
    s.mode = "idle";
    return;
  }
  s.mode = "comingOut";
}
