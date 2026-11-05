import { test, expect, beforeAll } from "bun:test";
import { build, render, scruffOffset, BUFFER } from "../../src/olex/model";

const { W, H, HANG_Y } = BUFFER;

beforeAll(() => build());

const filled = (out: (string | null)[]) => out.filter(Boolean).length;

test("standing olex fits inside the buffer", () => {
  const out = render(W, H, { yaw: 0 });
  expect(filled(out)).toBeGreaterThan(150);
  for (let x = 0; x < W; x++) expect(out[x]).toBeNull();
});

test("facing left mirrors facing right", () => {
  const right = render(W, H, { yaw: 0 });
  const left = render(W, H, { yaw: Math.PI });
  let diff = 0;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      if (Boolean(right[y * W + x]) !== Boolean(left[y * W + (W - 1 - x)])) diff++;
  // pixel rounding at the mirror seam allows a small mismatch
  expect(diff).toBeLessThan(W);
});

test("scruff offset mirrors with facing", () => {
  const [rx, ry] = scruffOffset(0);
  const [lx, ly] = scruffOffset(Math.PI);
  expect(lx).toBeCloseTo(-rx, 9);
  expect(ly).toBeCloseTo(ry, 9);
});

test("carried pose draws the scruff at the hang pivot", () => {
  const out = render(W, H, { yaw: 0, hang: 1.2 });
  let near = false;
  for (let y = HANG_Y - 2; y <= HANG_Y + 2; y++)
    for (let x = W / 2 - 2; x <= W / 2 + 2; x++) if (out[y * W + x]) near = true;
  expect(near).toBe(true);
});
