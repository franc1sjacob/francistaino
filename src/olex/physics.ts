import { landingCrossed, type Platform } from "./world";

export type Hop = { fx: number; fy: number; tx: number; ty: number; t: number; dur: number; h: number };

// position along a hop arc at its current tick
export function hopPos(h: Hop): { x: number; y: number; done: boolean } {
  const k = h.t / h.dur;
  if (k >= 1) return { x: h.tx, y: h.ty, done: true };
  return {
    x: h.fx + (h.tx - h.fx) * k,
    y: h.fy + (h.ty - h.fy) * k - Math.sin(Math.PI * k) * h.h,
    done: false,
  };
}

// carried swing: springs toward rest, damped, and trails behind pointer motion
export function stepPendulum(s: { a: number; v: number }, rest: number, pointerVx: number): void {
  s.v += -0.02 * (s.a - rest) - 0.09 * s.v - 0.006 * pointerVx;
  s.a += s.v;
}

export function stepFall(f: { y: number; v: number }, g = 0.6, max = 14): void {
  f.v = Math.min(f.v + g, max);
  f.y += f.v;
}

export type Ball = { x: number; y: number; vx: number; vy: number; resting: boolean };

const BALL_G = 0.5;
const BOUNCE = 0.55;
const ROLL = 0.94;

export function stepBall(b: Ball, ps: Platform[], bounds: { left: number; right: number }): void {
  if (b.resting) return;
  b.vy += BALL_G;
  const prevY = b.y;
  b.x += b.vx;
  b.y += b.vy;
  if (b.x < bounds.left) { b.x = bounds.left; b.vx = -b.vx * 0.7; }
  if (b.x > bounds.right) { b.x = bounds.right; b.vx = -b.vx * 0.7; }
  if (b.vy <= 0) return;
  const hit = landingCrossed(ps, b.x, prevY, b.y);
  if (hit < 0) return;
  b.y = ps[hit].y;
  b.vy = -b.vy * BOUNCE;
  b.vx *= ROLL;
  if (Math.abs(b.vy) < 1.2) {
    // rolling along the line
    b.vy = 0;
    if (Math.abs(b.vx) < 0.15) { b.vx = 0; b.resting = true; }
  }
}

const THROW_WINDOW_MS = 80;
const FRAME_MS = 16;
const MAX_THROW = 30;

// pointer flick velocity in px per frame, from samples in the last 80ms
export function throwVelocity(samples: { x: number; y: number; t: number }[]): { vx: number; vy: number } {
  if (samples.length < 2) return { vx: 0, vy: 0 };
  const last = samples[samples.length - 1];
  const recent = samples.filter((s) => s.t >= last.t - THROW_WINDOW_MS);
  const first = recent[0];
  const dt = last.t - first.t;
  if (recent.length < 2 || dt <= 0) return { vx: 0, vy: 0 };
  const clamp = (v: number) => Math.max(-MAX_THROW, Math.min(MAX_THROW, v));
  return {
    vx: clamp(((last.x - first.x) / dt) * FRAME_MS),
    vy: clamp(((last.y - first.y) / dt) * FRAME_MS),
  };
}

const TICK_MS = 1000 / 60;
const MAX_CATCH_UP = 4;

// how many 60Hz brain ticks to run for a frame of dt ms, so speed never depends on the display's refresh rate
export function fixedSteps(acc: number, dt: number): { steps: number; acc: number } {
  acc += dt;
  const steps = Math.floor(acc / TICK_MS);
  if (steps > MAX_CATCH_UP) return { steps: MAX_CATCH_UP, acc: 0 }; // drop the backlog after a stall
  return { steps, acc: acc - steps * TICK_MS };
}
