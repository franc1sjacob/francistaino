// Persistence that never throws: storage can be blocked (private mode), so every access
// falls back to an in-memory copy that lasts for the session.

export type SavedState = { x: number; vy: number; dir: 1 | -1 };

const HOME = "olex:home";
const PETS = "olex:pets";
const STATE = "olex:state";

export function createStore(local: Storage | null, session: Storage | null) {
  const memory = new Map<string, string>();
  const get = (s: Storage | null, k: string): string | null => {
    try {
      const v = s?.getItem(k);
      if (v != null) return v;
    } catch {
      // blocked storage: use the in-memory copy
    }
    return memory.get(k) ?? null;
  };
  const set = (s: Storage | null, k: string, v: string): void => {
    memory.set(k, v);
    try {
      s?.setItem(k, v);
    } catch {
      // blocked storage: the in-memory copy still holds it
    }
  };

  return {
    getHome: () => get(local, HOME) === "1",
    setHome: (v: boolean) => set(local, HOME, v ? "1" : "0"),
    getPets: () => {
      const n = Number(get(local, PETS));
      return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
    },
    setPets: (n: number) => set(local, PETS, String(n)),
    getSession: (): SavedState | null => {
      try {
        const v = JSON.parse(get(session, STATE) ?? "null");
        return v && typeof v.x === "number" && typeof v.vy === "number" ? v : null;
      } catch {
        return null;
      }
    },
    setSession: (st: SavedState) => set(session, STATE, JSON.stringify(st)),
  };
}

export type Store = ReturnType<typeof createStore>;

function safe(get: () => Storage): Storage | null {
  try {
    return get();
  } catch {
    return null; // even touching window.localStorage can throw
  }
}

export const store: Store = createStore(
  typeof window === "undefined" ? null : safe(() => window.localStorage),
  typeof window === "undefined" ? null : safe(() => window.sessionStorage),
);
