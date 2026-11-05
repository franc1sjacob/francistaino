import { test, expect } from "bun:test";
import { createGestureTracker } from "../../src/olex/input";

const tracker = () => createGestureTracker({ dragPx: 4, longPressMs: 500 });
const kinds = (gs: { kind: string }[]) => gs.map((g) => g.kind);

test("a click without movement is a pet", () => {
  const t = tracker();
  t.down(100, 100, 0, 0, false);
  t.move(102, 101, 50);
  expect(kinds(t.up(120))).toEqual(["pet"]);
});

test("moving past the threshold starts a drag that ends on release", () => {
  const t = tracker();
  t.down(100, 100, 0, 0, false);
  expect(kinds(t.move(110, 100, 16))).toEqual(["dragStart", "dragMove"]);
  const m = t.move(120, 100, 32);
  expect(m).toEqual([{ kind: "dragMove", x: 120, y: 100, vx: 10 }]);
  expect(kinds(t.up(48))).toEqual(["dragEnd"]);
});

test("a cancelled pointer mid-drag still ends the drag", () => {
  const t = tracker();
  t.down(100, 100, 0, 0, true);
  t.move(130, 100, 16);
  expect(kinds(t.cancel())).toEqual(["dragEnd"]);
  expect(kinds(t.up(40))).toEqual([]); // nothing left to end
});

test("right button opens the menu right away", () => {
  const t = tracker();
  expect(t.down(100, 100, 0, 2, false)).toEqual([{ kind: "menu", x: 100, y: 100 }]);
  expect(kinds(t.up(30))).toEqual([]);
});

test("holding a touch still for 500ms opens the menu instead of petting", () => {
  const t = tracker();
  t.down(100, 100, 0, 0, true);
  expect(kinds(t.tick(400))).toEqual([]);
  expect(t.tick(510)).toEqual([{ kind: "menu", x: 100, y: 100 }]);
  expect(kinds(t.up(600))).toEqual([]);
});

test("a touch that moves 12px within 500ms drags and never opens the menu", () => {
  const t = tracker();
  t.down(100, 100, 0, 0, true);
  expect(kinds(t.move(112, 100, 200))).toEqual(["dragStart", "dragMove"]);
  expect(kinds(t.tick(600))).toEqual([]);
});

test("mouse long-press does not open the menu", () => {
  const t = tracker();
  t.down(100, 100, 0, 0, false);
  expect(kinds(t.tick(800))).toEqual([]);
  expect(kinds(t.up(900))).toEqual(["pet"]);
});
