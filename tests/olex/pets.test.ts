import { test, expect } from "bun:test";
import { createPetCounter } from "../../src/olex/pets";
import { createStore } from "../../src/olex/store";

type Call = { method: string; n?: number };

function setup(opts: { url?: string; respond?: (c: Call) => Promise<Response> } = {}) {
  let now = 0;
  const calls: Call[] = [];
  const beacons: string[] = [];
  let total = 1000;
  const respond = opts.respond ?? (async (c: Call) => {
    if (c.method === "POST") total += c.n!;
    return new Response(JSON.stringify({ total }), { status: 200 });
  });
  const counter = createPetCounter({
    url: opts.url ?? "https://counter.test/pets",
    fetch: (async (_url: string, init?: RequestInit) => {
      const c: Call = { method: init?.method ?? "GET", n: init?.body ? JSON.parse(String(init.body)).n : undefined };
      calls.push(c);
      return respond(c);
    }) as typeof fetch,
    now: () => now,
    beacon: (_u, body) => (beacons.push(body), true),
    store: createStore(null, null),
  });
  return { counter, calls, beacons, tick: (ms: number) => (now += ms), getTotal: () => total };
}

test("25 quick pets go out as a batch of 20, then the remaining 5", async () => {
  const { counter, calls, tick } = setup();
  for (let i = 0; i < 25; i++) counter.pet();
  expect(counter.label()).toStartWith("♥ 25 from you");
  await counter.flush();
  tick(3000);
  await counter.flush();
  expect(calls.filter((c) => c.method === "POST").map((c) => c.n)).toEqual([20, 5]);
});

test("sends at most once every 3 seconds", async () => {
  const { counter, calls, tick } = setup();
  counter.pet();
  await counter.flush();
  counter.pet();
  tick(1000);
  await counter.flush();
  expect(calls.filter((c) => c.method === "POST").length).toBe(1);
  tick(2000);
  await counter.flush();
  expect(calls.filter((c) => c.method === "POST").length).toBe(2);
});

test("the shown total counts pets not yet sent, and never double counts after the reply", async () => {
  const { counter, tick } = setup();
  await counter.loadTotal();
  expect(counter.label()).toBe("♥ 0 from you · 1,000 total");
  counter.pet();
  counter.pet();
  expect(counter.label()).toBe("♥ 2 from you · 1,002 total");
  tick(3000);
  await counter.flush();
  expect(counter.label()).toBe("♥ 2 from you · 1,002 total");
});

test("if the service is down, pets are kept, the total hides, and the next flush retries them", async () => {
  let down = true;
  let total = 50;
  const { counter, calls, tick } = setup({
    respond: async (c) => {
      if (down) throw new TypeError("Failed to fetch");
      if (c.method === "POST") total += c.n!;
      return new Response(JSON.stringify({ total }));
    },
  });
  await counter.loadTotal();
  for (let i = 0; i < 3; i++) counter.pet();
  tick(3000);
  await counter.flush();
  expect(counter.label()).toBe("♥ 3 from you");
  down = false;
  tick(6000); // one failure backs off to 6s
  await counter.flush();
  expect(calls.filter((c) => c.method === "POST").map((c) => c.n)).toEqual([3, 3]);
  expect(counter.label()).toBe("♥ 3 from you · 53 total");
});

test("a 429 drops the refused pets and updates the total without retrying", async () => {
  const { counter, calls, tick } = setup({
    respond: async () => new Response(JSON.stringify({ total: 77 }), { status: 429 }),
  });
  for (let i = 0; i < 4; i++) counter.pet();
  tick(3000);
  await counter.flush();
  tick(3000);
  await counter.flush();
  expect(calls.filter((c) => c.method === "POST").length).toBe(1);
  expect(counter.label()).toBe("♥ 4 from you · 77 total");
});

test("leaving the page beacons whatever is still queued", () => {
  const { counter, beacons } = setup();
  counter.pet();
  counter.pet();
  counter.onPageHide();
  expect(beacons).toEqual([JSON.stringify({ n: 2 })]);
  counter.onPageHide();
  expect(beacons.length).toBe(1);
});

test("with no service configured only the personal count shows and nothing is sent", async () => {
  const { counter, calls, beacons, tick } = setup({ url: "" });
  counter.pet();
  await counter.loadTotal();
  tick(3000);
  await counter.flush();
  counter.onPageHide();
  expect(calls.length).toBe(0);
  expect(beacons.length).toBe(0);
  expect(counter.label()).toBe("♥ 1 from you");
});

test("the personal count survives a reload through the store", () => {
  const store = createStore(null, null);
  const make = () => createPetCounter({ url: "", fetch: fetch, now: () => 0, beacon: () => true, store });
  make().pet();
  make().pet();
  expect(make().label()).toBe("♥ 2 from you");
});

test("leaving mid-request does not beacon the pets already being sent", async () => {
  let release!: () => void;
  const { counter, beacons } = setup({
    respond: () => new Promise((r) => (release = () => r(new Response(JSON.stringify({ total: 5 }))))),
  });
  for (let i = 0; i < 3; i++) counter.pet();
  const sending = counter.flush();
  counter.pet();
  counter.onPageHide();
  expect(beacons).toEqual([JSON.stringify({ n: 1 })]);
  release();
  await sending;
});

test("review: when the service keeps failing, retries back off instead of hammering it", async () => {
  const { counter, calls, tick } = setup({ respond: async () => new Response("down", { status: 503 }) });
  counter.pet();
  for (let i = 0; i < 60; i++) { tick(1000); await counter.flush(); } // a minute of 1s flush ticks
  const posts = calls.filter((c) => c.method === "POST").length;
  expect(posts).toBeLessThanOrEqual(6); // 3s, 6s, 12s, 24s, 48s... not 20
  expect(posts).toBeGreaterThanOrEqual(3);
});

test("review: a success resets the backoff", async () => {
  let fail = true;
  const { counter, calls, tick } = setup({
    respond: async () => (fail ? new Response("down", { status: 503 }) : new Response(JSON.stringify({ total: 1 }))),
  });
  counter.pet();
  for (let i = 0; i < 30; i++) { tick(1000); await counter.flush(); }
  fail = false;
  for (let i = 0; i < 60; i++) { tick(1000); await counter.flush(); }
  const before = calls.filter((c) => c.method === "POST").length;
  counter.pet();
  tick(3000);
  await counter.flush();
  expect(calls.filter((c) => c.method === "POST").length).toBe(before + 1);
});
