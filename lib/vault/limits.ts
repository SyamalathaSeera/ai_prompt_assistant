/** Bounded session retention. Expired or evicted placeholders remain unresolved. */
export const MAX_ENTRIES = 200;
/** Four-hour sliding expiry; never used to allocate or recycle placeholder IDs. */
export const TTL_MS = 4 * 60 * 60 * 1000;
