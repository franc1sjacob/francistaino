// Where the shared pet total lives. Public by nature; empty means "personal count only".
// Set PUBLIC_OLEX_COUNTER_URL to point dev at `wrangler dev`.
export const COUNTER_URL: string = import.meta.env.PUBLIC_OLEX_COUNTER_URL ?? "https://olex-counter.francistaino.workers.dev/pets";
