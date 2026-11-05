import { test, expect } from "bun:test";
import { isThrow } from "../../src/olex/ball";

test("review: a plain click while waiting for a throw is not a throw", () => {
  expect(isThrow([{ x: 100, y: 100, t: 0 }, { x: 101, y: 100, t: 80 }])).toBe(false);
});

test("review: a flick is a throw", () => {
  expect(isThrow([{ x: 100, y: 100, t: 0 }, { x: 140, y: 90, t: 40 }])).toBe(true);
});
