import { browser } from 'wxt/browser';

/**
 * Session vault: placeholder -> real value.
 *
 * This module deliberately creates the one place in the extension where real
 * secrets exist, so ADR-005 constrains it tightly:
 *
 *  - Backed by `chrome.storage.session` — memory-backed, cleared on browser
 *    restart, never synced. NEVER `.local`, NEVER `.sync`. Writing secrets to
 *    disk would turn a tool that prevents secret sprawl into a new place
 *    secrets accumulate, which is the exact failure this product exists to
 *    prevent.
 *  - Entries are scoped per conversation so placeholders cannot bleed between
 *    chats. `[REDACTED_AWS_KEY_1]` means different things in two different
 *    conversations, and showing one chat's key inside another would be a leak
 *    of our own making.
 *  - Hard entry cap with least-recently-used eviction; the vault must not grow
 *    without bound over a long session.
 *
 * Consequence, accepted deliberately: re-hydration does not survive a browser
 * restart. A stale placeholder in old scrollback is a far smaller cost than
 * becoming a secret store.
 */

/** Single storage key holding the whole map. One read, one write, no fan-out. */
const STORAGE_KEY = 'apa:vault';

/**
 * Maximum retained values.
 *
 * Generous enough that a normal session never evicts, small enough that a
 * pathological one cannot grow unbounded. Eviction is not a correctness
 * problem: a miss renders the placeholder unchanged, which is exactly what the
 * model was sent.
 */
export const MAX_ENTRIES = 200;

/**
 * How long an unused entry is kept, measured from last access.
 *
 * Sliding rather than fixed: a conversation someone is actively working in
 * keeps re-resolving the same placeholders and stays hydrated, while one they
 * walked away from expires. A fixed lifetime would break re-hydration
 * mid-session on a long task, which is exactly when it is most useful.
 *
 * Four hours is short enough that a shared or unattended machine does not hold
 * secrets all day, and long enough to cover a working session.
 */
export const TTL_MS = 4 * 60 * 60 * 1000;

export interface VaultEntry {
  placeholder: string;
  conversationId: string;
  createdAt: number;
  lastAccessedAt: number;
}

interface VaultRecord extends VaultEntry {
  value: string;
}

type VaultMap = Record<string, VaultRecord>;

/**
 * Composite key.
 *
 * The separator is a character that cannot appear in a conversation id or in
 * our placeholder format, so two different pairs cannot collide.
 */
function keyFor(conversationId: string, placeholder: string): string {
  return `${conversationId}␟${placeholder}`;
}

/** Removes entries past their sliding expiry. */
function sweepExpired(map: VaultMap, now = Date.now()): VaultMap {
  const live: VaultMap = {};
  for (const [key, record] of Object.entries(map)) {
    if (now - record.lastAccessedAt < TTL_MS) live[key] = record;
  }
  return live;
}

/**
 * Reads the live vault.
 *
 * Expired entries are filtered on every read, so a value is never returned
 * past its lifetime even if no write has happened to sweep it. Expiry is a
 * promise about what is retained, not merely about what is tidied up.
 */
async function readAll(): Promise<VaultMap> {
  try {
    const stored = await browser.storage.session.get(STORAGE_KEY);
    const map = stored[STORAGE_KEY];
    if (typeof map !== 'object' || map === null) return {};
    return sweepExpired(map as VaultMap);
  } catch {
    // Session storage is unavailable in some contexts. A vault that cannot be
    // read simply means no re-hydration — never a broken page.
    return {};
  }
}

async function writeAll(map: VaultMap): Promise<void> {
  try {
    await browser.storage.session.set({ [STORAGE_KEY]: map });
  } catch {
    /* see readAll: failure degrades to no re-hydration */
  }
}

/**
 * Drops the least recently accessed entries until the map is within the cap.
 *
 * Recency beats age here: a long conversation keeps re-using the same few
 * placeholders, and evicting by creation time would throw away exactly the
 * values still being displayed.
 */
function evictOldest(map: VaultMap): VaultMap {
  const entries = Object.entries(map);
  if (entries.length <= MAX_ENTRIES) return map;

  entries.sort(([, a], [, b]) => b.lastAccessedAt - a.lastAccessedAt);
  return Object.fromEntries(entries.slice(0, MAX_ENTRIES));
}

/** Stores the real value behind a placeholder, scoped to one conversation. */
export async function put(
  placeholder: string,
  value: string,
  conversationId: string,
): Promise<void> {
  const map = await readAll();
  const now = Date.now();

  map[keyFor(conversationId, placeholder)] = {
    placeholder,
    conversationId,
    value,
    createdAt: now,
    lastAccessedAt: now,
  };

  await writeAll(evictOldest(map));
}

/** Stores several mappings at once — the output of one redaction pass. */
export async function putAll(
  entries: Readonly<Record<string, string>>,
  conversationId: string,
): Promise<void> {
  const pairs = Object.entries(entries);
  if (pairs.length === 0) return;

  const map = await readAll();
  const now = Date.now();

  for (const [placeholder, value] of pairs) {
    map[keyFor(conversationId, placeholder)] = {
      placeholder,
      conversationId,
      value,
      createdAt: now,
      lastAccessedAt: now,
    };
  }

  await writeAll(evictOldest(map));
}

/**
 * Returns the real value for a placeholder, or null on a miss.
 *
 * Takes the conversation id rather than the placeholder alone: placeholders
 * are numbered per prompt, so the same token means different things in
 * different chats.
 */
export async function resolve(
  placeholder: string,
  conversationId: string,
): Promise<string | null> {
  const map = await readAll();
  const record = map[keyFor(conversationId, placeholder)];
  if (!record) return null;

  // Touch for LRU. Fire-and-forget: a failed write costs a later eviction
  // decision, never a wrong value.
  record.lastAccessedAt = Date.now();
  void writeAll(map);

  return record.value;
}

/** Clears one conversation's entries, or the entire vault when omitted. */
export async function purge(conversationId?: string): Promise<void> {
  if (conversationId === undefined) {
    try {
      await browser.storage.session.remove(STORAGE_KEY);
    } catch {
      /* nothing further we can safely do */
    }
    return;
  }

  const map = await readAll();
  for (const [key, record] of Object.entries(map)) {
    if (record.conversationId === conversationId) delete map[key];
  }
  await writeAll(map);
}

/** Number of values currently held. Shown in the popup — visibility builds trust. */
export async function size(): Promise<number> {
  return Object.keys(await readAll()).length;
}

/** Entry metadata WITHOUT values, for diagnostics and the popup. */
export async function list(): Promise<VaultEntry[]> {
  const map = await readAll();
  return Object.values(map).map(({ placeholder, conversationId, createdAt, lastAccessedAt }) => ({
    placeholder,
    conversationId,
    createdAt,
    lastAccessedAt,
  }));
}
