// Counts pets: the visitor's own count (stored locally) plus a shared total from the counter service.
// Pets are batched so the service sees at most one request every few seconds.

import type { Store } from "./store";

const SEND_EVERY_MS = 3000;
const MAX_BACKOFF_MS = 60_000;
const MAX_BATCH = 20;
const TIMEOUT_MS = 2000;

type Deps = {
  url: string;                 // empty: personal count only
  fetch: typeof fetch;
  now: () => number;
  beacon: (url: string, body: string) => boolean;
  store: Store;
};

export function createPetCounter(d: Deps) {
  let personal = d.store.getPets();
  let queued = 0;              // pets not yet acknowledged by the service
  let total: number | null = null;
  let lastSent = -Infinity;
  let inflight = 0;            // pets in the request currently on the wire
  let failures = 0;            // consecutive failed sends, for backoff

  async function request(init?: RequestInit): Promise<Response> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      return await d.fetch(d.url, { ...init, signal: ctrl.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  async function readTotal(res: Response): Promise<void> {
    const body = await res.json().catch(() => null);
    total = typeof body?.total === "number" ? body.total : null;
  }

  return {
    pet(): void {
      personal++;
      queued++;
      d.store.setPets(personal);
    },

    async flush(): Promise<void> {
      // back off while the service is failing: 3s, 6s, 12s... up to a minute
      const wait = Math.min(MAX_BACKOFF_MS, SEND_EVERY_MS * 2 ** failures);
      if (!d.url || !queued || inflight || d.now() - lastSent < wait) return;
      const n = Math.min(queued, MAX_BATCH);
      inflight = n;
      lastSent = d.now();
      try {
        const res = await request({ method: "POST", body: JSON.stringify({ n }), headers: { "content-type": "application/json" } });
        if (res.ok || res.status === 429) {
          // accepted, or refused for good (rate limited): either way these pets are settled
          queued -= n;
          failures = 0;
          await readTotal(res);
        } else {
          total = null;
          failures++;
        }
      } catch {
        total = null; // offline or timed out: keep the pets and try again later
        failures++;
      } finally {
        inflight = 0;
      }
    },

    async loadTotal(): Promise<void> {
      if (!d.url) return;
      try {
        const res = await request();
        if (res.ok) await readTotal(res);
        else total = null;
      } catch {
        total = null;
      }
    },

    onPageHide(): void {
      const waiting = queued - inflight; // the in-flight batch is already on its way
      if (!d.url || waiting <= 0) return;
      const n = Math.min(waiting, MAX_BATCH);
      if (d.beacon(d.url, JSON.stringify({ n }))) queued -= n;
    },

    label(): string {
      const mine = `♥ ${personal.toLocaleString("en-US")} from you`;
      if (total === null) return mine;
      return `${mine} · ${(total + queued).toLocaleString("en-US")} total`;
    },
  };
}
