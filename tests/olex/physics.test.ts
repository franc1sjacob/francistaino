import { test, expect } from "bun:test";
import { hopPos, stepPendulum, stepFall, stepBall, throwVelocity, fixedSteps, type Hop, type Ball } from "../../src/olex/physics";
import type { Platform } from "../../src/olex/world";

test("hop starts at the origin, ends at the target, and arcs above both", () => {
  const h: Hop = { fx: 0, fy: 100, tx: 60, ty: 80, t: 0, dur: 20, h: 26 };
  expect(hopPos(h)).toEqual({ x: 0, y: 100, done: false });
  let minY = Infinity;
  for (let t = 0; t <= 20; t++) minY = Math.min(minY, hopPos({ ...h, t }).y);
  expect(minY).toBeLessThan(80 - 15);
  expect(hopPos({ ...h, t: 20 })).toEqual({ x: 60, y: 80, done: true });
});

test("pendulum settles at its rest angle", () => {
  const s = { a: 0, v: 0 };
  for (let i = 0; i < 300; i++) stepPendulum(s, 1.15, 0);
  expect(Math.abs(s.a - 1.15)).toBeLessThan(0.01);
});

test("moving the pointer right swings the body the other way first", () => {
  const s = { a: 0, v: 0 };
  stepPendulum(s, 0, 20);
  expect(s.a).toBeLessThan(0);
});

test("falls accelerate but never exceed the max speed", () => {
  const f = { y: 0, v: 0 };
  for (let i = 0; i < 100; i++) stepFall(f, 0.6, 14);
  expect(f.v).toBe(14);
  expect(f.y).toBeGreaterThan(1000);
});

const line: Platform = { x1: 0, x2: 1000, y: 500, kind: "text" };

test("a dropped ball bounces lower each time and comes to rest on the platform", () => {
  const b: Ball = { x: 300, y: 300, vx: 0, vy: 0, resting: false };
  const peaks: number[] = [];
  let rising = false, lastY = b.y;
  for (let i = 0; i < 400 && !b.resting; i++) {
    stepBall(b, [line], { left: 0, right: 1000 });
    if (b.y < lastY) rising = true;
    else if (rising) { peaks.push(lastY); rising = false; }
    lastY = b.y;
    expect(b.y).toBeLessThanOrEqual(500);
  }
  expect(b.resting).toBe(true);
  expect(b.y).toBe(500);
  for (let i = 1; i < peaks.length; i++) expect(peaks[i]).toBeGreaterThan(peaks[i - 1]);
});

test("the ball rebounds off the page edge", () => {
  const b: Ball = { x: 990, y: 400, vx: 20, vy: 0, resting: false };
  stepBall(b, [line], { left: 0, right: 1000 });
  expect(b.vx).toBeLessThan(0);
  expect(b.x).toBeLessThanOrEqual(1000);
});

test("a fast ball never tunnels through a platform", () => {
  const b: Ball = { x: 300, y: 480, vx: 0, vy: 40, resting: false };
  stepBall(b, [line], { left: 0, right: 1000 });
  expect(b.y).toBeLessThanOrEqual(500);
});

test("throw velocity uses only the last 80ms and is clamped", () => {
  const v = throwVelocity([
    { x: 0, y: 0, t: 0 },
    { x: 500, y: 0, t: 10 }, // old flick, ignored
    { x: 500, y: 0, t: 200 },
    { x: 530, y: -16, t: 248 }, // 30px right, 16px up over 48ms (3 frames)
  ]);
  expect(v.vx).toBeCloseTo(10, 5);
  expect(v.vy).toBeCloseTo(-16 / 3, 5);
  const fast = throwVelocity([{ x: 0, y: 0, t: 0 }, { x: 900, y: 0, t: 16 }]);
  expect(fast.vx).toBe(30);
});

test("fixed steps run 60 ticks per second regardless of display refresh rate", () => {
  let acc = 0, ticks120 = 0, ticks60 = 0;
  for (let i = 0; i < 120; i++) { const r = fixedSteps(acc, 1000 / 120); acc = r.acc; ticks120 += r.steps; }
  acc = 0;
  for (let i = 0; i < 60; i++) { const r = fixedSteps(acc, 1000 / 60); acc = r.acc; ticks60 += r.steps; }
  expect(Math.abs(ticks120 - 60)).toBeLessThanOrEqual(1);
  expect(Math.abs(ticks60 - 60)).toBeLessThanOrEqual(1);
});

test("a long stall (background tab) runs at most a few catch-up ticks", () => {
  const r = fixedSteps(0, 5000);
  expect(r.steps).toBe(4);
  expect(r.acc).toBe(0);
});
