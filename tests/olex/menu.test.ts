import { test, expect } from "bun:test";
import { menuPosition, COMMANDS } from "../../src/olex/menu";

test("the menu opens down and to the right of the pointer when there is room", () => {
  expect(menuPosition(100, 100, 160, 220, 1200, 800)).toEqual({ left: 100, top: 100 });
});

test("near the right and bottom edges the menu flips to stay on screen", () => {
  expect(menuPosition(1150, 700, 160, 220, 1200, 800)).toEqual({ left: 990, top: 480 });
});

test("the menu never goes past the top-left corner", () => {
  expect(menuPosition(50, 100, 160, 220, 180, 200)).toEqual({ left: 0, top: 0 });
});

test("every command from the spec is in the menu", () => {
  expect(COMMANDS).toEqual(["sit", "fetch", "roll over", "spin", "treat", "nap", "follow me", "zoomies", "go home"]);
});
