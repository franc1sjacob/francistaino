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

function bounds(out: (string | null)[], x0 = 0, x1 = W) {
  let top = H, bottom = -1;
  for (let y = 0; y < H; y++)
    for (let x = x0; x < x1; x++)
      if (out[y * W + x]) {
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      }
  return { top, bottom, height: bottom - top };
}

test("sitting lowers his back end", () => {
  // at yaw 0 he faces right, so his rear is the left part of the buffer
  const stand = bounds(render(W, H, { yaw: 0 }), 0, W / 2 - 4);
  const sit = bounds(render(W, H, { yaw: 0, pose: "sit", poseT: 1 }), 0, W / 2 - 4);
  expect(sit.top - stand.top).toBeGreaterThanOrEqual(3);
});

test("curled up for a nap he is shorter than standing", () => {
  const stand = bounds(render(W, H, { yaw: 0 }));
  const curl = bounds(render(W, H, { yaw: 0, pose: "curl", poseT: 1 }));
  expect(curl.height).toBeLessThan(stand.height - 3);
});

test("rolled over he is still on the ground", () => {
  const roll = bounds(render(W, H, { yaw: 0, pose: "lie", poseT: 1 }));
  expect(roll.bottom).toBeGreaterThanOrEqual(H - BUFFER.GROUND - 2);
});

test("wagging only moves the tail", () => {
  const a = render(W, H, { yaw: 0, tailWag: 0 });
  const b = render(W, H, { yaw: 0, tailWag: Math.PI / 2 });
  let changed = 0, outsideTail = 0;
  for (let i = 0; i < W * H; i++)
    if (a[i] !== b[i]) {
      changed++;
      if (i % W > W / 2 - 4) outsideTail++; // his rear half at yaw 0
    }
  expect(changed).toBeGreaterThan(0);
  expect(outsideTail).toBe(0);
});
