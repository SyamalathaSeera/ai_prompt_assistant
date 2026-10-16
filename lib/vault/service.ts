import { browser } from 'wxt/browser';
import { placeholderPattern } from '../detector/engine';

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
 *  - Entries are scoped per conversation. New submissions also carry a session
 *    epoch and monotonically increasing submission number.
 *  - Hard entry cap with least-recently-used eviction; the vault must not grow
 *    without bound over a long session.
 *
 * Consequence, accepted deliberately: re-hydration does not survive a browser
 * restart. A stale placeholder in old scrollback is a far smaller cost than
 * becoming a secret store.
 */

/** Single storage key holding the whole map. One read, one write, no fan-out. */
const STORAGE_KEY = 'apa:vault';

import { MAX_ENTRIES, TTL_MS } from './limits';

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
  const stored = await browser.storage.session.get(STORAGE_KEY);
  const map: unknown = stored[STORAGE_KEY];
  if (map === undefined) return {};
  if (typeof map !== 'object' || map === null || Array.isArray(map)) {
    throw new Error('Vault storage is invalid');
  }
  for (const record of Object.values(map)) {
    if (
      !record ||
      typeof record !== 'object' ||
      typeof record.value !== 'string' ||
      typeof record.placeholder !== 'string' ||
      typeof record.conversationId !== 'string' ||
      !Number.isFinite(record.createdAt) ||
      !Number.isFinite(record.lastAccessedAt)
    ) {
      throw new Error('Vault storage is invalid');
    }
  }
  return sweepExpired(map as VaultMap);
}

async function writeAll(map: VaultMap): Promise<void> {
  await browser.storage.session.set({ [STORAGE_KEY]: map });
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

/** Stores several mappings at once — the output of one redaction pass. */
async function putAll(
  entries: Readonly<Record<string, string>>,
  conversationId: string,
): Promise<void> {
  const pairs = Object.entries(entries);
  if (pairs.length === 0) return;
  if (pairs.length > MAX_ENTRIES) throw new Error('Vault capacity exceeded');

  const map = await readAll();
  const now = Date.now();

  for (const [placeholder, value] of pairs) {
    const previous = map[keyFor(conversationId, placeholder)];
    if (previous && previous.value !== value)
      throw new Error('Vault placeholder conflict');
    map[keyFor(conversationId, placeholder)] = {
      placeholder,
      conversationId,
      value,
      createdAt: previous?.createdAt ?? now,
      lastAccessedAt: now,
    };
  }

  await writeAll(evictOldest(map));
}

/**
 * Returns the real value for a placeholder, or null on a miss.
 *
 * Conversation scope remains required, including for legacy placeholders.
 */
async function resolve(
  placeholder: string,
  conversationId: string,
): Promise<string | null> {
  const map = await readAll();
  const record = map[keyFor(conversationId, placeholder)];
  if (!record) return null;

  // All reads and writes run in the background queue, including LRU touches.
  record.lastAccessedAt = Date.now();
  await writeAll(map);

  return record.value;
}

/** Clears one conversation's entries, or the entire vault when omitted. */
async function purge(conversationId?: string): Promise<void> {
  if (conversationId === undefined) {
    await browser.storage.session.remove(STORAGE_KEY);
    return;
  }

  const map = await readAll();
  for (const [key, record] of Object.entries(map)) {
    if (record.conversationId === conversationId) delete map[key];
  }
  await writeAll(map);
}

/** Number of values currently held. Shown in the popup — visibility builds trust. */
async function size(): Promise<number> {
  return Object.keys(await readAll()).length;
}

/** Entry metadata WITHOUT values, for diagnostics and the popup. */
async function list(): Promise<VaultEntry[]> {
  const map = await readAll();
  return Object.values(map).map(
    ({ placeholder, conversationId, createdAt, lastAccessedAt }) => ({
      placeholder,
      conversationId,
      createdAt,
      lastAccessedAt,
    }),
  );
}

export type VaultRequest =
  | {
      type: 'apa:vault';
      op: 'putAll';
      entries: Record<string, string>;
      conversationId: string;
    }
  | {
      type: 'apa:vault';
      op: 'persist';
      entries: Record<string, string>;
      conversationId: string;
      text: string;
      retain: boolean;
    }
  | { type: 'apa:vault'; op: 'resolve'; placeholder: string; conversationId: string }
  | { type: 'apa:vault'; op: 'purge'; conversationId?: string }
  | { type: 'apa:vault'; op: 'size' | 'list' | 'clear' };

export type VaultResponse = { ok: true; value: unknown } | { ok: false };

function validRequest(value: unknown): value is VaultRequest {
  if (!value || typeof value !== 'object') return false;
  const r = value as Record<string, unknown>;
  if (r.type !== 'apa:vault') return false;
  if (r.op === 'size' || r.op === 'list' || r.op === 'clear') return true;
  if (r.op === 'purge')
    return r.conversationId === undefined || typeof r.conversationId === 'string';
  if (typeof r.conversationId !== 'string' || !r.conversationId) return false;
  if (r.op === 'resolve') return typeof r.placeholder === 'string';
  if (r.op !== 'putAll' && r.op !== 'persist') return false;
  if (r.op === 'persist' && (typeof r.text !== 'string' || typeof r.retain !== 'boolean'))
    return false;
  return (
    !!r.entries &&
    typeof r.entries === 'object' &&
    !Array.isArray(r.entries) &&
    Object.entries(r.entries).every(
      ([key, val]) =>
        typeof val === 'string' && key.match(placeholderPattern())?.[0] === key,
    )
  );
}

// Retained separately from entries: expiry, eviction and purge must not reuse IDs.
const SEQUENCE_KEY = 'apa:vault:sequence';

async function persist(
  request: Extract<VaultRequest, { op: 'persist' }>,
): Promise<string> {
  const present = new Set(request.text.match(placeholderPattern()) ?? []);
  const pairs = Object.entries(request.entries).filter(([key]) => present.has(key));
  if (!pairs.length) return request.text;
  if (pairs.length > MAX_ENTRIES) throw new Error('Vault capacity exceeded');
  const map = await readAll();
  const stored = await browser.storage.session.get(SEQUENCE_KEY);
  const raw: unknown = stored[SEQUENCE_KEY];
  if (raw !== undefined && (!raw || typeof raw !== 'object' || Array.isArray(raw)))
    throw new Error('Vault sequence is invalid');
  const sequence = (raw ?? {
    epoch: crypto.randomUUID().replaceAll('-', '').toUpperCase(),
    counter: 0,
  }) as { epoch: string; counter: number };
  if (
    typeof sequence.epoch !== 'string' ||
    !/^[A-F0-9]{32}$/.test(sequence.epoch) ||
    !Number.isSafeInteger(sequence.counter) ||
    sequence.counter < 0 ||
    sequence.counter >= Number.MAX_SAFE_INTEGER
  ) {
    throw new Error('Vault sequence is invalid');
  }
  const counter = sequence.counter + 1;
  const namespace = `S${sequence.epoch}_${counter}`;
  const replacements = new Map<string, string>();
  const now = Date.now();
  for (const [placeholder, value] of pairs) {
    const scoped = placeholder
      .replace(/_(\d+)(\]?)$/, `_${namespace}_$1$2`)
      .replace(/S([A-F0-9]{32})/, (match) =>
        placeholder.startsWith('dummy_') ? match.toLowerCase() : match,
      );
    if (
      scoped === placeholder ||
      request.text.includes(scoped) ||
      map[keyFor(request.conversationId, scoped)]
    ) {
      throw new Error('Vault placeholder conflict');
    }
    replacements.set(placeholder, scoped);
    if (request.retain)
      map[keyFor(request.conversationId, scoped)] = {
        placeholder: scoped,
        value,
        conversationId: request.conversationId,
        createdAt: now,
        lastAccessedAt: now,
      };
  }
  // Evict older values, never any mapping this operation promises to retain.
  const fresh = new Set(
    [...replacements.values()].map((p) => keyFor(request.conversationId, p)),
  );
  const ordered = Object.entries(map).sort(
    ([a, x], [b, y]) =>
      Number(fresh.has(b)) - Number(fresh.has(a)) || y.lastAccessedAt - x.lastAccessedAt,
  );
  const retained = Object.fromEntries(ordered.slice(0, MAX_ENTRIES));
  await browser.storage.session.set({
    [STORAGE_KEY]: retained,
    [SEQUENCE_KEY]: { epoch: sequence.epoch, counter },
  });
  return request.text.replace(
    placeholderPattern(),
    (token) => replacements.get(token) ?? token,
  );
}

let pending: Promise<unknown> = Promise.resolve();

/** One queue in the background worker serializes every client, including reads and purge. */
export function handleVaultRequest(message: unknown): Promise<VaultResponse> {
  const operation = pending.then(async (): Promise<VaultResponse> => {
    try {
      if (!validRequest(message)) return { ok: false };
      let value: unknown;
      switch (message.op) {
        case 'putAll':
          value = await putAll(message.entries, message.conversationId);
          break;
        case 'persist':
          value = await persist(message);
          break;
        case 'resolve':
          value = await resolve(message.placeholder, message.conversationId);
          break;
        case 'purge':
          value = await purge(message.conversationId);
          break;
        case 'size':
          value = await size();
          break;
        case 'list':
          value = await list();
          break;
        case 'clear':
          value = await browser.storage.session.clear();
          break;
      }
      return { ok: true, value: value ?? null };
    } catch {
      // Never forward storage exceptions: they may include submitted values.
      return { ok: false };
    }
  });
  pending = operation;
  return operation;
}

export function startVaultService(): void {
  browser.runtime.onMessage.addListener((message, sender) => {
    if (!message || typeof message !== 'object' || message.type !== 'apa:vault') return;
    if (sender.id !== browser.runtime.id) return Promise.resolve({ ok: false });
    return handleVaultRequest(message);
  });
}
