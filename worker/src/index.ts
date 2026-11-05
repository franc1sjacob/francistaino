// Olex's pet counter: one Durable Object holds the shared total, so increments never race.

import { DurableObject } from "cloudflare:workers";
import { clampN, corsHeaders, createLimiter } from "./rules";

export interface Env {
  PETS: DurableObjectNamespace<PetCounter>;
  SALT?: string;
}

const PER_MINUTE = 120;

export class PetCounter extends DurableObject<Env> {
  // in memory only: resets if the object is evicted, which is fine for spam limits
  private limiter = createLimiter(PER_MINUTE);

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS pets (id INTEGER PRIMARY KEY CHECK (id = 1), total INTEGER NOT NULL)");
      this.ctx.storage.sql.exec("INSERT OR IGNORE INTO pets (id, total) VALUES (1, 0)");
    });
  }

  total(): number {
    return this.ctx.storage.sql.exec<{ total: number }>("SELECT total FROM pets WHERE id = 1").one().total;
  }

  add(n: number, visitor: string): { total: number; limited: boolean } {
    if (!this.limiter.allow(visitor, n, Date.now())) return { total: this.total(), limited: true };
    this.ctx.storage.sql.exec("UPDATE pets SET total = total + ? WHERE id = 1", n);
    return { total: this.total(), limited: false };
  }
}

// visitors are told apart by a salted hash of their IP; the IP itself is never stored
async function visitorKey(req: Request, salt: string): Promise<string> {
  const ip = req.headers.get("CF-Connecting-IP") ?? "unknown";
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(salt + ip));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const cors = corsHeaders(req.headers.get("Origin"));
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { ...cors, "content-type": "application/json" } });

    if (new URL(req.url).pathname !== "/pets") return json({ error: "not found" }, 404);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    const counter = env.PETS.getByName("global");
    if (req.method === "GET") return json({ total: await counter.total() });
    if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

    // beacons arrive as text/plain, so parse the body whatever its content type says
    let n = 1;
    try {
      n = clampN(JSON.parse(await req.text())?.n);
    } catch {
      n = 1;
    }
    const { total, limited } = await counter.add(n, await visitorKey(req, env.SALT ?? ""));
    return json({ total }, limited ? 429 : 200);
  },
} satisfies ExportedHandler<Env>;
