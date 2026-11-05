// Counts pets: the visitor's own count (stored locally) plus a shared total from the counter service.
// Pets are batched so the service sees at most one request every few seconds.

import type { Store } from "./store";

const SEND_EVERY_MS = 3000;
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
      if (!d.url || !queued || inflight || d.now() - lastSent < SEND_EVERY_MS) return;
      const n = Math.min(queued, MAX_BATCH);
      inflight = n;
      lastSent = d.now();
      try {
        const res = await request({ method: "POST", body: JSON.stringify({ n }), headers: { "content-type": "application/json" } });
        if (res.ok || res.status === 429) {
          // accepted, or refused for good (rate limited): either way these pets are settled
          queued -= n;
          await readTotal(res);
        } else total = null;
      } catch {
        total = null; // offline or timed out: keep the pets and try again next time
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
