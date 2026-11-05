import { test, expect } from "bun:test";
import { createStore } from "../../src/olex/store";

function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, String(v)),
    removeItem: (k) => void m.delete(k),
    clear: () => m.clear(),
    key: () => null,
    get length() { return m.size; },
  };
}

const throwing = (): Storage => {
  const fail = () => { throw new Error("SecurityError"); };
  return { getItem: fail, setItem: fail, removeItem: fail, clear: fail, key: fail, get length() { return fail(); } } as Storage;
};

test("home flag and pet count persist in local storage", () => {
  const local = memoryStorage();
  createStore(local, memoryStorage()).setHome(true);
  createStore(local, memoryStorage()).setPets(42);
  const again = createStore(local, memoryStorage());
  expect(again.getHome()).toBe(true);
  expect(again.getPets()).toBe(42);
});

test("defaults when nothing is stored", () => {
  const s = createStore(memoryStorage(), memoryStorage());
  expect(s.getHome()).toBe(false);
  expect(s.getPets()).toBe(0);
  expect(s.getSession()).toBeNull();
});

test("session state round-trips", () => {
  const s = createStore(memoryStorage(), memoryStorage());
  s.setSession({ x: 300, vy: 120, dir: -1 });
  expect(s.getSession()).toEqual({ x: 300, vy: 120, dir: -1 });
});

test("when storage throws (private mode), nothing throws and values last for the session", () => {
  const s = createStore(throwing(), throwing());
  expect(s.getHome()).toBe(false);
  expect(() => s.setHome(true)).not.toThrow();
  expect(s.getHome()).toBe(true);
  s.setPets(7);
  expect(s.getPets()).toBe(7);
  s.setSession({ x: 1, vy: 2, dir: 1 });
  expect(s.getSession()).toEqual({ x: 1, vy: 2, dir: 1 });
});

test("garbage in storage falls back to defaults", () => {
  const local = memoryStorage();
  local.setItem("olex:pets", "lots");
  const session = memoryStorage();
  session.setItem("olex:state", "{not json");
  const s = createStore(local, session);
  expect(s.getPets()).toBe(0);
  expect(s.getSession()).toBeNull();
});
