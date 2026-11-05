// Platforms olex can stand on, in document coordinates.

export type Platform = { x1: number; x2: number; y: number; kind: "text" | "floor" | "house" };
export type View = { top: number; bottom: number };

const BOXES = "main pre, main img";
const MIN_WIDTH = 24;
const REACH_X = 40;
const JOIN_GAP = 72; // wide enough to join a "now  value" row across its label column
const SAME_LINE = 4;

// one platform per rendered line of text (or box, for pre/img), plus the footer line as the floor
export function measure(doc: Document): Platform[] {
  const sx = doc.defaultView?.scrollX ?? 0, sy = doc.defaultView?.scrollY ?? 0;
  const rects: DOMRect[] = [];
  for (const el of doc.querySelectorAll(BOXES)) rects.push(el.getBoundingClientRect());
  const main = doc.querySelector("main");
  if (main) {
    // measure text runs, not element boxes, so empty space inside blocks is never walkable
    const walker = doc.createTreeWalker(main, NodeFilter.SHOW_TEXT);
    const range = doc.createRange();
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!n.textContent?.trim() || n.parentElement?.closest("pre")) continue;
      range.selectNodeContents(n);
      rects.push(...range.getClientRects());
    }
  }
  const ps: Platform[] = [];
  for (const r of rects) {
    if (r.width === 0 || r.height === 0) continue;
    const p: Platform = { x1: r.left + sx, x2: r.right + sx, y: Math.round(r.top + sy), kind: "text" };
    // nested elements and label/value rows produce several rects per line; join them into one walkway
    const same = ps.find((q) => Math.abs(q.y - p.y) <= SAME_LINE && p.x1 <= q.x2 + JOIN_GAP && p.x2 >= q.x1 - JOIN_GAP);
    if (same) {
      same.x1 = Math.min(same.x1, p.x1);
      same.x2 = Math.max(same.x2, p.x2);
    } else ps.push(p);
  }
  const walkable = ps.filter((p) => p.x2 - p.x1 >= MIN_WIDTH);
  const footer = doc.querySelector(".site-footer");
  if (footer) {
    const r = footer.getBoundingClientRect();
    walkable.push({ x1: r.left + sx, x2: r.right + sx, y: Math.round(r.top + sy), kind: "floor" });
  }
  return walkable;
}

const spans = (p: Platform, x: number) => x >= p.x1 && x <= p.x2;

// index of the highest platform at or below y that spans x
export function platformUnder(ps: Platform[], x: number, y: number): number {
  let best = -1;
  ps.forEach((p, i) => {
    if (p.y >= y && spans(p, x) && (best < 0 || p.y < ps[best].y)) best = i;
  });
  if (best < 0) best = ps.findIndex((p) => p.kind === "floor");
  return best;
}

// the platform whose top was crossed while moving from prevY down to nextY, or -1
export function landingCrossed(ps: Platform[], x: number, prevY: number, nextY: number): number {
  let best = -1;
  ps.forEach((p, i) => {
    if (spans(p, x) && prevY <= p.y && p.y <= nextY && (best < 0 || p.y < ps[best].y)) best = i;
  });
  return best;
}

// platforms olex can hop to from `from`: any drop, climbs of at most maxUp px
export function reachable(ps: Platform[], from: number, maxUp: number): number[] {
  const a = ps[from];
  const out: number[] = [];
  ps.forEach((p, i) => {
    if (i === from) return;
    if (p.x2 < a.x1 - REACH_X || p.x1 > a.x2 + REACH_X) return;
    if (p.y < a.y - maxUp) return;
    if (p.y === a.y) return;
    out.push(i);
  });
  return out;
}

// a visible platform near the upper quarter of the viewport, for dropping back into view
export function nearestVisible(ps: Platform[], view: View): number {
  const target = view.top + (view.bottom - view.top) * 0.25;
  let best = -1;
  ps.forEach((p, i) => {
    if (p.y < view.top || p.y > view.bottom) return;
    if (best < 0 || Math.abs(p.y - target) < Math.abs(ps[best].y - target)) best = i;
  });
  if (best < 0) best = ps.findIndex((p) => p.kind === "floor");
  return best;
}
