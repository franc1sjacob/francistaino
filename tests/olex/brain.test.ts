import { test, expect } from "bun:test";
import { initState, tick, onPageSwap, handle, pickIdle, type World, type State } from "../../src/olex/brain";
import type { Platform } from "../../src/olex/world";

const text = (x1: number, x2: number, y: number): Platform => ({ x1, x2, y, kind: "text" });
const floor: Platform = { x1: 0, x2: 1000, y: 900, kind: "floor" };

export function world(plats: Platform[], over: Partial<World> = {}): World {
  return {
    plats, view: { top: 0, bottom: 1000 }, now: 0, reducedMotion: false, paused: false, rand: () => 0.9,
    scruff: (yaw) => [10 * Math.cos(yaw), 30], cursor: null, hover: false, ...over,
  };
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

test("dragging carries him by the scruff and he swings behind the pointer", () => {
  const w = world([text(100, 300, 400), floor]);
  const s = initState(w);
  Object.assign(s, { plat: 0, x: 200, y: 400, mode: "walk" });
  handle(s, { kind: "dragStart", x: 210, y: 370 }, w);
  expect(s.mode).toBe("carried");
  run(s, w, 60); // settle into the resting hang
  const rest = s.swingA;
  expect(rest).toBeGreaterThan(0.5);
  handle(s, { kind: "dragMove", x: 260, y: 370, vx: 50 }, w);
  run(s, w, 3);
  expect(s.swingA).toBeLessThan(rest);
  expect(s.pivot.x).toBeGreaterThan(240);
});

test("released, he falls, lands on the line under his feet, shakes, and walks on", () => {
  const w = world([text(100, 300, 400), text(400, 700, 600), floor]);
  const s = initState(w);
  Object.assign(s, { plat: 0, x: 200, y: 400, mode: "walk" });
  handle(s, { kind: "dragStart", x: 210, y: 370 }, w);
  handle(s, { kind: "dragMove", x: 510, y: 300, vx: 0 }, w);
  run(s, w, 40);
  handle(s, { kind: "dragEnd" }, w);
  const seen = new Set<string>();
  run(s, w, 200, (s) => seen.add(s.mode));
  expect(seen.has("drop")).toBe(true);
  expect(seen.has("shake")).toBe(true);
  expect(s.plat).toBe(1);
  expect(s.y).toBe(600);
  expect(["walk", "turn"]).toContain(s.mode);
});

test("petting turns him to face you, then he goes back to walking", () => {
  const w = world([text(100, 300, 400), floor]);
  const s = initState(w);
  Object.assign(s, { plat: 0, x: 200, y: 400, mode: "walk" });
  handle(s, { kind: "pet" }, w);
  expect(s.mode).toBe("pet");
  run(s, w, 30);
  expect(s.yaw).toBeCloseTo(Math.PI / 2, 5);
  run(s, w, 200);
  expect(["walk", "turn"]).toContain(s.mode);
});

test("four quick pets make him spin", () => {
  const w = world([text(100, 300, 400), floor]);
  const s = initState(w);
  Object.assign(s, { plat: 0, x: 200, y: 400, mode: "walk" });
  for (let i = 0; i < 4; i++) {
    handle(s, { kind: "pet" }, w);
    run(s, w, 20);
  }
  expect(s.mode).toBe("spin");
});

test("grabbing him mid-hop cancels the hop", () => {
  const w = world([text(100, 300, 400), text(250, 600, 350), floor], { rand: () => 0.1 });
  const s = initState(w);
  Object.assign(s, { plat: 0, x: 280, y: 400, dir: 1, mode: "walk" });
  for (let i = 0; i < 100 && s.mode !== "hop"; i++) run(s, w, 1);
  expect(s.mode).toBe("hop");
  handle(s, { kind: "dragStart", x: s.x, y: s.y - 30 }, w);
  expect(s.mode).toBe("carried");
  expect(s.hop).toBeNull();
});

test("idle behaviors never repeat back to back", () => {
  const w = world([text(100, 300, 400), floor]);
  const s = initState(w);
  const seq = [0, 0, 0.3, 0.3, 0.99, 0.99, 0.5, 0.1, 0.1, 0.7];
  let prev = "";
  for (let i = 0; i < 40; i++) {
    const idle = pickIdle(s, () => seq[i % seq.length]);
    expect(idle).not.toBe(prev);
    prev = idle;
  }
});

test("after 30s without interaction he curls up for a nap, and a pet wakes him", () => {
  const w = world([text(100, 300, 400), floor]);
  const s = initState(w);
  Object.assign(s, { plat: 0, x: 200, y: 400, mode: "walk" });
  run(s, w, 1700); // ~27s
  expect(s.idle).not.toBe("nap");
  run(s, w, 300); // past 30s
  expect(s.idle).toBe("nap");
  run(s, w, 30);
  expect(s.pose).toBe("curl");
  handle(s, { kind: "pet" }, w);
  run(s, w, 30);
  expect(s.idle).not.toBe("nap");
});

test("he notices a cursor resting nearby for a second and trots over", () => {
  const w = world([text(100, 600, 400), floor]);
  const s = initState(w);
  Object.assign(s, { plat: 0, x: 200, y: 400, mode: "walk", dir: 1 });
  w.cursor = { x: 340, y: 360, stillSince: 0 };
  run(s, w, 30); // ~0.5s still: not yet
  expect(s.idle).not.toBe("notice");
  run(s, w, 40); // past 1s
  expect(s.idle).toBe("notice");
  run(s, w, 200);
  expect(Math.abs(s.x - 340)).toBeLessThan(40);
});

test("he ignores a cursor resting far away", () => {
  const w = world([text(100, 900, 400), floor]);
  const s = initState(w);
  Object.assign(s, { plat: 0, x: 200, y: 400, mode: "walk", dir: 1 });
  w.cursor = { x: 600, y: 300, stillSince: 0 };
  run(s, w, 150);
  expect(s.idle).not.toBe("notice");
});

test("hovering makes his tail wag", () => {
  const w = world([text(100, 300, 400), floor]);
  const s = initState(w);
  Object.assign(s, { plat: 0, x: 200, y: 400, mode: "walk" });
  run(s, w, 5);
  expect(s.wag).toBeNull();
  w.hover = true;
  run(s, w, 5);
  expect(s.wag).not.toBeNull();
});
