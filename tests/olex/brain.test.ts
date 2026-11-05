import { test, expect } from "bun:test";
import { initState, tick, onPageSwap, type World, type State } from "../../src/olex/brain";
import type { Platform } from "../../src/olex/world";

const text = (x1: number, x2: number, y: number): Platform => ({ x1, x2, y, kind: "text" });
const floor: Platform = { x1: 0, x2: 1000, y: 900, kind: "floor" };

export function world(plats: Platform[], over: Partial<World> = {}): World {
  return { plats, view: { top: 0, bottom: 1000 }, now: 0, reducedMotion: false, paused: false, rand: () => 0.9, ...over };
}

function run(s: State, w: World, n: number, each?: (s: State) => void) {
  for (let i = 0; i < n; i++) {
    w.now += 16;
    tick(s, w);
    each?.(s);
  }
}

test("walking to an edge turns around through facing the viewer", () => {
  const w = world([text(100, 300, 400), floor]);
  const s = initState(w);
  Object.assign(s, { plat: 0, x: 260, y: 400, dir: 1, mode: "walk" });
  let closestToFront = Infinity;
  run(s, w, 200, (s) => (closestToFront = Math.min(closestToFront, Math.abs(s.yaw - Math.PI / 2))));
  expect(s.dir).toBe(-1);
  expect(closestToFront).toBeLessThan(0.07);
});

test("walking to an edge can hop to a reachable platform", () => {
  const w = world([text(100, 300, 400), text(250, 600, 350), floor], { rand: () => 0.1 });
  const s = initState(w);
  Object.assign(s, { plat: 0, x: 260, y: 400, dir: 1, mode: "walk" });
  let hopped = false;
  run(s, w, 120, (s) => (hopped ||= s.mode === "hop"));
  expect(hopped).toBe(true);
  expect(s.plat).not.toBe(0);
  expect(s.y).toBe(w.plats[s.plat].y);
});

test("yaw never jumps more than 0.12 rad per tick", () => {
  const w = world([text(100, 300, 400), floor]);
  const s = initState(w);
  Object.assign(s, { plat: 0, x: 200, y: 400, dir: 1, mode: "walk" });
  let prev = s.yaw;
  run(s, w, 600, (s) => {
    expect(Math.abs(s.yaw - prev)).toBeLessThanOrEqual(0.12 + 1e-9);
    prev = s.yaw;
  });
});

test("if his platform disappears he falls and lands on what is below", () => {
  const w = world([text(100, 300, 400), floor]);
  const s = initState(w);
  Object.assign(s, { plat: 0, x: 200, y: 400, mode: "walk" });
  w.plats = [floor];
  run(s, w, 1);
  expect(s.mode).toBe("fall");
  run(s, w, 200);
  expect(s.y).toBe(900);
  expect(s.plat).toBe(0);
  expect(s.mode).not.toBe("fall");
});

test("after 10s offscreen he drops back into view", () => {
  const w = world([text(100, 300, 400), text(100, 500, 2200), floor], { view: { top: 2000, bottom: 2800 } });
  const s = initState(w);
  Object.assign(s, { plat: 0, x: 200, y: 400, mode: "walk" });
  run(s, w, 300); // ~5s
  expect(s.plat).toBe(0);
  run(s, w, 400); // past 10s
  run(s, w, 200); // fall in
  expect(s.plat).toBe(1);
  expect(s.y).toBe(2200);
});

test("with reduced motion he sits still", () => {
  const w = world([text(100, 300, 400), floor], { reducedMotion: true });
  const s = initState(w);
  const x = s.x;
  run(s, w, 100);
  expect(s.mode).toBe("idle");
  expect(s.pose).toBe("sit");
  expect(s.x).toBe(x);
});

test("he does not walk while text is being selected", () => {
  const w = world([text(100, 300, 400), floor], { paused: true });
  const s = initState(w);
  Object.assign(s, { plat: 0, x: 200, y: 400, mode: "walk" });
  run(s, w, 50);
  expect(s.x).toBe(200);
});

test("after a page swap he lands somewhere visible, not on a line below the fold", () => {
  const w = world([text(100, 300, 300), text(800, 1000, 1500), { ...floor, y: 2000 }], { view: { top: 0, bottom: 1000 } });
  const s = initState(w);
  Object.assign(s, { x: 900, y: 400, mode: "walk", plat: 5 });
  onPageSwap(s, w);
  run(s, w, 200);
  expect(s.plat).toBe(0);
  expect(s.y).toBe(300);
});

test("after a page swap he falls straight down when a visible line is below him", () => {
  const w = world([text(100, 300, 300), text(800, 1000, 600), { ...floor, y: 2000 }]);
  const s = initState(w);
  Object.assign(s, { x: 900, y: 400, mode: "walk", plat: 5 });
  onPageSwap(s, w);
  for (let i = 0; i < 200 && (i === 0 || s.mode === "fall"); i++) run(s, w, 1);
  expect(s.plat).toBe(1);
  expect(s.x).toBe(900);
});
