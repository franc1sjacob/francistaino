import { test, expect } from "bun:test";
import { initState, tick, onPageSwap, handle, pickIdle, runCommand, clickAnywhere, throwBall, endFetch, callOut, startFall, houseInFront, type World, type State } from "../../src/olex/brain";
import type { Platform } from "../../src/olex/world";

const text = (x1: number, x2: number, y: number): Platform => ({ x1, x2, y, kind: "text" });
const floor: Platform = { x1: 0, x2: 1000, y: 900, kind: "floor" };

export function world(plats: Platform[], over: Partial<World> = {}): World {
  return {
    plats, view: { top: 0, bottom: 1000 }, now: 0, reducedMotion: false, paused: false, rand: () => 0.9,
    scruff: (yaw) => [10 * Math.cos(yaw), 30], cursor: null, hover: false, bounds: { left: 0, right: 1000 }, house: null, ...over,
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

function onLine(over: Partial<World> = {}) {
  const w = world([text(100, 700, 400), floor], over);
  const s = initState(w);
  Object.assign(s, { plat: 0, x: 300, y: 400, mode: "walk", dir: 1 });
  return { s, w };
}

test("sit: he sits and stays until petted", () => {
  const { s, w } = onLine();
  runCommand(s, "sit", w);
  run(s, w, 600);
  expect(s.cmd).toBe("sit");
  expect(s.pose).toBe("sit");
  expect(s.x).toBe(300);
  handle(s, { kind: "pet" }, w);
  expect(s.cmd).toBeNull();
});

test("roll over: he rolls onto his back, then gets back up", () => {
  const { s, w } = onLine();
  runCommand(s, "roll over", w);
  let lay = false;
  run(s, w, 60, (s) => (lay ||= s.pose === "lie" && s.poseT === 1));
  expect(lay).toBe(true);
  run(s, w, 300);
  expect(s.cmd).toBeNull();
  expect(s.pose).toBe("stand");
});

test("spin: he chases his tail", () => {
  const { s, w } = onLine();
  runCommand(s, "spin", w);
  expect(s.mode).toBe("spin");
});

test("treat: a bone appears, he walks to it, eats it, and is happy", () => {
  const { s, w } = onLine();
  runCommand(s, "treat", w);
  expect(s.treat).not.toBeNull();
  const bone = s.treat!.x;
  let hearts = 0, eatenAt: number | null = null;
  run(s, w, 400, (s) => {
    hearts += s.events.filter((e) => e === "heart").length;
    if (eatenAt === null && s.treat === null) eatenAt = s.x;
  });
  expect(eatenAt).not.toBeNull();
  expect(Math.abs(eatenAt! - bone)).toBeLessThan(12);
  expect(hearts).toBeGreaterThan(0);
});

test("nap: he curls up right away", () => {
  const { s, w } = onLine();
  runCommand(s, "nap", w);
  expect(s.idle).toBe("nap");
});

test("follow me: he trails the cursor until you click somewhere", () => {
  const { s, w } = onLine({ cursor: { x: 600, y: 380, stillSince: 0 } });
  runCommand(s, "follow me", w);
  run(s, w, 300);
  expect(Math.abs(s.x - 600)).toBeLessThan(40);
  w.cursor = { x: 150, y: 380, stillSince: 0 };
  run(s, w, 400);
  expect(Math.abs(s.x - 150)).toBeLessThan(40);
  clickAnywhere(s, w);
  expect(s.cmd).toBeNull();
});

test("zoomies: he sprints for about 6s, then flops down, then recovers", () => {
  const { s, w } = onLine();
  runCommand(s, "zoomies", w);
  const start = s.x;
  let maxDist = 0;
  run(s, w, 340, (s) => (maxDist = Math.max(maxDist, Math.abs(s.x - start)))); // ~5.4s
  expect(s.cmd).toBe("zoomies");
  expect(maxDist).toBeGreaterThan(200);
  run(s, w, 60); // past 6s
  expect(s.cmd).toBe("flop");
  expect(s.poseGoal).toBe("lie");
  run(s, w, 300);
  expect(s.cmd).toBeNull();
});

function fetchRound(ballPlat: Platform, ballX: number) {
  const w = world([text(100, 400, 400), ballPlat, floor], { cursor: { x: 200, y: 360, stillSince: 0 } });
  const s = initState(w);
  Object.assign(s, { plat: 0, x: 220, y: 400, mode: "walk", dir: 1 });
  runCommand(s, "fetch", w);
  expect(s.fetch?.phase).toBe("wait");
  throwBall(s, { x: ballX, y: ballPlat.y, vx: 0, vy: 0, resting: true }, w);
  const phases = new Set<string>();
  let picked = false;
  for (let i = 0; i < 1250 && !(picked && s.fetch?.phase === "wait"); i++) {
    run(s, w, 1);
    phases.add(s.fetch?.phase ?? "none");
    if (s.fetch?.phase === "carry") picked = true;
  }
  return { s, phases };
}

test("fetch: he hops over to a reachable ball, brings it back, and waits for the next throw", () => {
  const { s, phases } = fetchRound(text(380, 800, 350), 650);
  expect(phases.has("chase")).toBe(true);
  expect(phases.has("carry")).toBe(true);
  expect(s.fetch?.phase).toBe("wait");
  expect(s.fetch?.ball).toBeNull();
  expect(s.plat).toBe(0);
  expect(Math.abs(s.x - 200)).toBeLessThan(40);
});

test("fetch: a ball out of hopping reach gets a long leap", () => {
  const { s, phases } = fetchRound(text(600, 900, 300), 750);
  expect(phases.has("carry")).toBe(true);
  expect(s.fetch?.phase).toBe("wait");
  expect(Math.abs(s.x - 200)).toBeLessThan(40);
});

test("a thrown ball flies, lands, and he chases it", () => {
  const w = world([text(100, 900, 400), floor], { cursor: { x: 200, y: 360, stillSince: 0 } });
  const s = initState(w);
  Object.assign(s, { plat: 0, x: 220, y: 400, mode: "walk", dir: 1 });
  runCommand(s, "fetch", w);
  throwBall(s, { x: 200, y: 360, vx: 8, vy: -6, resting: false }, w);
  run(s, w, 400);
  expect(["carry", "wait"]).toContain(s.fetch?.phase);
});

test("petting him or pressing escape ends the game", () => {
  const w = world([text(100, 900, 400), floor]);
  const s = initState(w);
  Object.assign(s, { plat: 0, x: 220, y: 400, mode: "walk" });
  runCommand(s, "fetch", w);
  handle(s, { kind: "pet" }, w);
  expect(s.fetch).toBeNull();
  runCommand(s, "fetch", w);
  endFetch(s);
  expect(s.fetch).toBeNull();
  expect(s.mode).not.toBe("fetch");
});

test("a ball lost off the page goes back to the cursor instead of falling forever", () => {
  const w = world([text(100, 400, 400)], { cursor: { x: 200, y: 360, stillSince: 0 }, bounds: { left: 0, right: 5000 } });
  const s = initState(w);
  Object.assign(s, { plat: 0, x: 220, y: 400, mode: "walk" });
  runCommand(s, "fetch", w);
  throwBall(s, { x: 450, y: 300, vx: 5, vy: 0, resting: false }, w);
  run(s, w, 600);
  expect(s.fetch?.phase).toBe("wait");
  expect(s.fetch?.ball).toBeNull();
});

function withHouse(plats: Platform[], house: { x1: number; x2: number; y: number }, over: Partial<World> = {}) {
  const w = world(plats, { house, ...over });
  const s = initState(w);
  return { s, w };
}

test("go home: from a nearby line he walks down into his house", () => {
  const f = { ...floor, y: 900 };
  const { s, w } = withHouse([text(100, 600, 400), f], { x1: 880, x2: 912, y: 900 });
  Object.assign(s, { plat: 0, x: 300, y: 400, mode: "walk" });
  runCommand(s, "go home", w);
  expect(s.mode).toBe("goingHome");
  run(s, w, 480); // 8s
  expect(s.mode).toBe("home");
});

test("go home: from far away he dashes so it still takes under 8s", () => {
  const f = { ...floor, y: 2900 };
  const { s, w } = withHouse([text(100, 300, 400), text(100, 700, 1600), f], { x1: 960, x2: 992, y: 2900 }, { view: { top: 0, bottom: 3000 } });
  Object.assign(s, { plat: 0, x: 150, y: 400, mode: "walk" });
  runCommand(s, "go home", w);
  run(s, w, 480);
  expect(s.mode).toBe("home");
});

test("at home nothing happens: no naps, no idles, no wandering", () => {
  const { s, w } = withHouse([text(100, 600, 400), floor], { x1: 880, x2: 912, y: 900 });
  Object.assign(s, { plat: 1, x: 896, y: 900, mode: "home" });
  run(s, w, 3000);
  expect(s.mode).toBe("home");
  expect(s.x).toBe(896);
});

test("called out, he comes out of the door onto the floor and walks off", () => {
  const { s, w } = withHouse([text(100, 600, 400), floor], { x1: 880, x2: 912, y: 900 });
  Object.assign(s, { plat: 1, x: 896, y: 900, mode: "home" });
  callOut(s, w);
  expect(s.mode).toBe("comingOut");
  run(s, w, 120);
  expect(s.mode).not.toBe("comingOut");
  expect(s.y).toBe(900);
  expect(s.x).toBeLessThan(880);
});

test("with reduced motion going home and coming out are instant", () => {
  const { s, w } = withHouse([text(100, 600, 400), floor], { x1: 880, x2: 912, y: 900 }, { reducedMotion: true });
  Object.assign(s, { plat: 0, x: 300, y: 400, mode: "idle" });
  runCommand(s, "go home", w);
  expect(s.mode).toBe("home");
  callOut(s, w);
  expect(s.mode).toBe("idle");
  expect(s.y).toBe(900);
});

test("after navigating to a shorter page (floor above him) he drops into view instead of falling forever", () => {
  const w = world([text(100, 600, 150), { ...floor, y: 345 }], { view: { top: 0, bottom: 1070 } });
  const s = initState(w);
  Object.assign(s, { x: 900, y: 716, mode: "walk", plat: 9 });
  onPageSwap(s, w);
  run(s, w, 200);
  expect(s.mode).not.toBe("fall");
  expect(s.y).toBeLessThanOrEqual(345);
});

test("a fall with nothing at all below him drops him back into view straight away", () => {
  const w = world([text(100, 600, 150)], { view: { top: 0, bottom: 1000 } });
  const s = initState(w);
  Object.assign(s, { x: 900, y: 500, mode: "walk", plat: 0 });
  startFall(s);
  run(s, w, 3);
  expect(s.x).toBeLessThanOrEqual(600);
  run(s, w, 100);
  expect(s.plat).toBe(0);
  expect(s.y).toBe(150);
});

test("review: if his line shifts while he heads home, he still gets home", () => {
  const f = { ...floor, y: 900 };
  const { s, w } = withHouse([text(100, 600, 400), f], { x1: 880, x2: 912, y: 900 });
  Object.assign(s, { plat: 0, x: 300, y: 400, mode: "walk" });
  runCommand(s, "go home", w);
  run(s, w, 20);
  w.plats = [text(100, 600, 380), f]; // a font loads and the line moves up 20px
  run(s, w, 480);
  expect(s.mode).toBe("home");
});

test("review: if his line shifts mid-fetch, he keeps playing", () => {
  const w = world([text(100, 900, 400), floor], { cursor: { x: 200, y: 360, stillSince: 0 } });
  const s = initState(w);
  Object.assign(s, { plat: 0, x: 220, y: 400, mode: "walk" });
  runCommand(s, "fetch", w);
  throwBall(s, { x: 600, y: 400, vx: 0, vy: 0, resting: true }, w);
  run(s, w, 10);
  w.plats = [text(100, 900, 385), floor];
  run(s, w, 80); // falls to the floor, then carries on
  expect(s.mode).toBe("fetch");
});

test("review: after a page swap mid-fetch he keeps playing", () => {
  const w = world([text(100, 900, 400), floor], { cursor: { x: 200, y: 360, stillSince: 0 } });
  const s = initState(w);
  Object.assign(s, { plat: 0, x: 220, y: 400, mode: "walk" });
  runCommand(s, "fetch", w);
  w.plats = [text(100, 900, 600), floor];
  onPageSwap(s, w);
  run(s, w, 100);
  expect(s.mode).toBe("fetch");
});

test("review: with reduced motion, energetic commands become a calm sit", () => {
  for (const c of ["zoomies", "spin", "roll over", "follow me"] as const) {
    const { s, w } = onLine({ reducedMotion: true });
    runCommand(s, c, w);
    run(s, w, 60);
    expect(s.cmd).toBe("sit");
    expect(s.mode).not.toBe("spin");
    expect(s.x).toBe(300);
  }
});

test("review: with reduced motion, carrying him does not swing", () => {
  const { s, w } = onLine({ reducedMotion: true });
  handle(s, { kind: "dragStart", x: 310, y: 370 }, w);
  handle(s, { kind: "dragMove", x: 400, y: 370, vx: 60 }, w);
  run(s, w, 30);
  expect(s.swingA).toBe(0);
});

test("dropped outside the text column, he comes back onto a visible line", () => {
  const w = world([text(100, 600, 400), floor], { view: { top: 0, bottom: 1000 } });
  const s = initState(w);
  Object.assign(s, { plat: 0, x: 300, y: 400, mode: "walk" });
  handle(s, { kind: "dragStart", x: 310, y: 370 }, w);
  handle(s, { kind: "dragMove", x: 1500, y: 300, vx: 0 }, w); // off to the side, past the floor
  run(s, w, 40);
  handle(s, { kind: "dragEnd" }, w);
  run(s, w, 200);
  expect(["walk", "turn", "shake", "hop", "idle"]).toContain(s.mode);
  expect(s.x).toBeLessThanOrEqual(1000);
  expect(s.y).toBeLessThanOrEqual(1000);
  expect(w.plats[s.plat]).toBeDefined();
  expect(s.y).toBe(w.plats[s.plat].y);
});

test("clicking the house while he is out does nothing", () => {
  const { s, w } = withHouse([text(100, 600, 400), floor], { x1: 880, x2: 912, y: 900 });
  Object.assign(s, { plat: 0, x: 300, y: 400, mode: "walk" });
  callOut(s, w);
  expect(s.mode).toBe("walk");
  expect(s.x).toBe(300);
});

test("the house stays behind him when he just walks past it", () => {
  const { s, w } = withHouse([text(100, 600, 400), floor], { x1: 880, x2: 944, y: 900 });
  Object.assign(s, { plat: 1, x: 912, y: 900, mode: "walk" });
  expect(houseInFront(s, w)).toBe(false);
  Object.assign(s, { mode: "goingHome", x: 600 });
  expect(houseInFront(s, w)).toBe(false); // still on his way
});

test("the house comes in front for his last steps through the door, and when he comes out", () => {
  const { s, w } = withHouse([text(100, 600, 400), floor], { x1: 880, x2: 944, y: 900 });
  Object.assign(s, { plat: 1, x: 890, y: 900, mode: "goingHome" });
  expect(houseInFront(s, w)).toBe(true);
  Object.assign(s, { mode: "comingOut", x: 900 });
  expect(houseInFront(s, w)).toBe(true);
  Object.assign(s, { mode: "home" });
  expect(houseInFront(s, w)).toBe(true);
});
