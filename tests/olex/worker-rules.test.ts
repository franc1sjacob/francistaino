import { test, expect } from "bun:test";
import { clampN, corsHeaders, createLimiter } from "../../worker/src/rules";

test("n is clamped to 1..20 and junk counts as 1", () => {
  expect(clampN(5)).toBe(5);
  expect(clampN("50")).toBe(20);
  expect(clampN(500)).toBe(20);
  expect(clampN(-3)).toBe(1);
  expect(clampN(0)).toBe(1);
  expect(clampN("x")).toBe(1);
  expect(clampN(undefined)).toBe(1);
  expect(clampN(2.7)).toBe(2);
});

test("only the site and local dev get CORS headers", () => {
  expect(corsHeaders("https://evil.com")).toEqual({});
  expect(corsHeaders(null)).toEqual({});
  const site = corsHeaders("https://francistaino.com");
  expect(site["Access-Control-Allow-Origin"]).toBe("https://francistaino.com");
  expect(site["Vary"]).toBe("Origin");
  expect(corsHeaders("http://localhost:4321")["Access-Control-Allow-Origin"]).toBe("http://localhost:4321");
});

test("a visitor can add 120 pets a minute, then is refused until the minute is up", () => {
  const limit = createLimiter(120);
  for (let i = 0; i < 6; i++) expect(limit.allow("a", 20, 1000 + i)).toBe(true);
  expect(limit.allow("a", 1, 2000)).toBe(false);
  expect(limit.allow("b", 20, 2000)).toBe(true); // other visitors unaffected
  expect(limit.allow("a", 1, 1000 + 60_000)).toBe(true);
});

test("a batch that would cross the limit is refused whole", () => {
  const limit = createLimiter(120);
  expect(limit.allow("a", 20, 0)).toBe(true);
  for (let i = 0; i < 4; i++) limit.allow("a", 20, 0);
  expect(limit.allow("a", 19, 0)).toBe(true); // 119
  expect(limit.allow("a", 2, 0)).toBe(false); // would be 121
});
