// Where the shared pet total lives. Public by nature; empty means "personal count only".
// Local dev never touches the live counter unless PUBLIC_OLEX_COUNTER_URL says so
// (e.g. http://localhost:8787/pets for `wrangler dev`).
const LIVE = "https://olex-counter.francistaino.workers.dev/pets";
export const COUNTER_URL: string = import.meta.env.PUBLIC_OLEX_COUNTER_URL ?? (import.meta.env.DEV ? "" : LIVE);
