import { test, expect } from "bun:test";
import { platformUnder, landingCrossed, reachable, nearestVisible, type Platform } from "../../src/olex/world";

const text = (x1: number, x2: number, y: number): Platform => ({ x1, x2, y, kind: "text" });
const floor: Platform = { x1: 0, x2: 1000, y: 900, kind: "floor" };

test("platformUnder picks the highest platform below the point that spans x", () => {
  const ps = [text(100, 400, 300), text(100, 400, 200), text(500, 700, 250), floor];
  expect(platformUnder(ps, 150, 150)).toBe(1);
  expect(platformUnder(ps, 150, 250)).toBe(0);
  expect(platformUnder(ps, 600, 100)).toBe(2);
});

test("platformUnder falls back to the floor, or -1 without one", () => {
  expect(platformUnder([text(100, 200, 100), floor], 800, 0)).toBe(1);
  expect(platformUnder([text(100, 200, 100)], 800, 0)).toBe(-1);
});

test("landingCrossed only detects a platform crossed this frame", () => {
  const ps = [text(0, 500, 300), floor];
  expect(landingCrossed(ps, 100, 290, 304)).toBe(0); // 14px step through the line
  expect(landingCrossed(ps, 100, 280, 290)).toBe(-1); // not reached yet
  expect(landingCrossed(ps, 100, 305, 320)).toBe(-1); // already below it
  expect(landingCrossed(ps, 600, 290, 304)).toBe(-1); // outside its span
});

test("reachable allows any drop but only short climbs", () => {
  const ps = [text(100, 300, 400), text(250, 450, 340), text(100, 300, 200), text(320, 500, 600), text(800, 900, 500)];
  const r = reachable(ps, 0, 80);
  expect(r).toContain(1); // up 60, overlapping
  expect(r).not.toContain(2); // up 200, too high
  expect(r).toContain(3); // down, within 40px horizontally
  expect(r).not.toContain(4); // too far sideways
  expect(r).not.toContain(0);
});

test("with only a floor, everything resolves to the floor", () => {
  expect(platformUnder([floor], 300, 100)).toBe(0);
  expect(nearestVisible([floor], { top: 0, bottom: 1200 })).toBe(0);
});

test("nearestVisible prefers platforms inside the viewport, nearest the top third", () => {
  const ps = [text(0, 100, 50), text(0, 100, 1300), text(0, 100, 1600), floor];
  expect(nearestVisible(ps, { top: 1200, bottom: 2000 })).toBe(1);
});

test("platformUnder never returns a floor that is above the point", () => {
  expect(platformUnder([text(100, 200, 100), { ...floor, y: 345 }], 800, 716)).toBe(-1);
});
