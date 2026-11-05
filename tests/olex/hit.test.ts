import { test, expect } from "bun:test";
import { opaqueAt } from "../../src/olex/hit";

// a 4x3 buffer with one opaque pixel at (2, 1), drawn at 2x with its top-left at page (100, 200)
const out = [null, null, null, null, null, null, "#000", null, null, null, null, null];
const frame = { out, W: 4, H: 3, origin: { x: 100, y: 200 }, scale: 2 };

test("a point over an opaque pixel hits him", () => {
  expect(opaqueAt(frame, 104, 202)).toBe(true);
  expect(opaqueAt(frame, 105.9, 203.9)).toBe(true);
});

test("transparent pixels and points outside the canvas do not", () => {
  expect(opaqueAt(frame, 100, 200)).toBe(false);
  expect(opaqueAt(frame, 106, 202)).toBe(false);
  expect(opaqueAt(frame, 50, 50)).toBe(false);
  expect(opaqueAt(frame, 109, 202)).toBe(false);
});
