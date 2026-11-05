// Pure rules for the pet counter, kept apart from the Worker runtime so they can be unit tested.

export const MAX_BATCH = 20;

const ALLOWED_ORIGINS = new Set(["https://francistaino.com", "http://localhost:4321"]);

// pets per request: 1..20, anything unparseable counts as one
export function clampN(raw: unknown): number {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, MAX_BATCH);
}

export function corsHeaders(origin: string | null): Record<string, string> {
  if (!origin || !ALLOWED_ORIGINS.has(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

// fixed one-minute windows per visitor key
export function createLimiter(perMinute: number) {
  const windows = new Map<string, { start: number; count: number }>();
  return {
    allow(key: string, n: number, now: number): boolean {
      let w = windows.get(key);
      if (!w || now - w.start >= 60_000) {
        w = { start: now, count: 0 };
        windows.set(key, w);
      }
      if (w.count + n > perMinute) return false;
      w.count += n;
      // forget old visitors so memory stays small
      if (windows.size > 10_000) for (const [k, v] of windows) if (now - v.start >= 60_000) windows.delete(k);
      return true;
    },
  };
}
