import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { list, MAX_ENTRIES, purge, put, putAll, resolve, size, TTL_MS } from './index';

const CHAT_A = 'conversation-a';
const CHAT_B = 'conversation-b';
const PLACEHOLDER = '[REDACTED_AWS_ACCESS_KEY_ID_1]';
const SECRET = 'AKIA3TZ2MRSYNTHETIC7';

beforeEach(() => {
  fakeBrowser.reset();
});

describe('storing and resolving', () => {
  it('round-trips a value', async () => {
    await put(PLACEHOLDER, SECRET, CHAT_A);
    expect(await resolve(PLACEHOLDER, CHAT_A)).toBe(SECRET);
  });

  it('returns null for an unknown placeholder', async () => {
    expect(await resolve(PLACEHOLDER, CHAT_A)).toBeNull();
  });

  it('stores a whole redaction map at once', async () => {
    await putAll(
      { '[REDACTED_A_1]': 'first', '[REDACTED_B_1]': 'second' },
      CHAT_A,
    );

    expect(await resolve('[REDACTED_A_1]', CHAT_A)).toBe('first');
    expect(await resolve('[REDACTED_B_1]', CHAT_A)).toBe('second');
  });

  it('ignores an empty map', async () => {
    await putAll({}, CHAT_A);
    expect(await size()).toBe(0);
  });

  it('overwrites on repeat', async () => {
    await put(PLACEHOLDER, 'first', CHAT_A);
    await put(PLACEHOLDER, 'second', CHAT_A);

    expect(await resolve(PLACEHOLDER, CHAT_A)).toBe('second');
    expect(await size()).toBe(1);
  });
});

describe('conversation scoping', () => {
  it('keeps the same placeholder separate across conversations', async () => {
    // Placeholders are numbered per prompt, so [REDACTED_AWS_KEY_1] means
    // different things in different chats. Showing one chat's key inside
    // another would be a leak of our own making.
    await put(PLACEHOLDER, 'secret-from-a', CHAT_A);
    await put(PLACEHOLDER, 'secret-from-b', CHAT_B);

    expect(await resolve(PLACEHOLDER, CHAT_A)).toBe('secret-from-a');
    expect(await resolve(PLACEHOLDER, CHAT_B)).toBe('secret-from-b');
  });

  it('does not resolve across conversations', async () => {
    await put(PLACEHOLDER, SECRET, CHAT_A);
    expect(await resolve(PLACEHOLDER, CHAT_B)).toBeNull();
  });
});

describe('purging', () => {
  it('clears a single conversation', async () => {
    await put(PLACEHOLDER, 'from-a', CHAT_A);
    await put(PLACEHOLDER, 'from-b', CHAT_B);

    await purge(CHAT_A);

    expect(await resolve(PLACEHOLDER, CHAT_A)).toBeNull();
    expect(await resolve(PLACEHOLDER, CHAT_B)).toBe('from-b');
  });

  it('clears everything when no conversation is given', async () => {
    await put(PLACEHOLDER, 'from-a', CHAT_A);
    await put(PLACEHOLDER, 'from-b', CHAT_B);

    await purge();

    expect(await size()).toBe(0);
  });

  it('is safe to call on an empty vault', async () => {
    await expect(purge()).resolves.toBeUndefined();
    await expect(purge(CHAT_A)).resolves.toBeUndefined();
  });
});

describe('eviction', () => {
  it('caps the number of retained values', async () => {
    const entries: Record<string, string> = {};
    for (let i = 0; i < MAX_ENTRIES + 50; i += 1) {
      entries[`[REDACTED_X_${i}]`] = `value-${i}`;
    }
    await putAll(entries, CHAT_A);

    expect(await size()).toBe(MAX_ENTRIES);
  });

  it('evicts least recently accessed, not oldest', async () => {
    // A long conversation re-uses the same few placeholders. Evicting by
    // creation time would discard exactly the values still on screen.
    await put('[REDACTED_OLD_1]', 'old-but-used', CHAT_A);
    for (let i = 0; i < MAX_ENTRIES - 1; i += 1) {
      await put(`[REDACTED_FILLER_${i}]`, `filler-${i}`, CHAT_A);
    }

    // Touch the oldest entry so it becomes the most recently accessed.
    expect(await resolve('[REDACTED_OLD_1]', CHAT_A)).toBe('old-but-used');

    // Push past the cap.
    await put('[REDACTED_NEW_1]', 'newest', CHAT_A);

    expect(await size()).toBe(MAX_ENTRIES);
    expect(await resolve('[REDACTED_OLD_1]', CHAT_A)).toBe('old-but-used');
  });
});

describe('ADR-005: secrets never reach persistent storage', () => {
  it('writes nothing to storage.local', async () => {
    await put(PLACEHOLDER, SECRET, CHAT_A);

    const local = await fakeBrowser.storage.local.get(null);
    expect(local).toEqual({});
    expect(JSON.stringify(local)).not.toContain(SECRET);
  });

  it('writes nothing to storage.sync', async () => {
    // `.sync` leaves the device entirely — the single worst place for this.
    await put(PLACEHOLDER, SECRET, CHAT_A);

    const sync = await fakeBrowser.storage.sync.get(null);
    expect(sync).toEqual({});
    expect(JSON.stringify(sync)).not.toContain(SECRET);
  });

  it('keeps values only in storage.session', async () => {
    await put(PLACEHOLDER, SECRET, CHAT_A);

    const session = await fakeBrowser.storage.session.get(null);
    expect(JSON.stringify(session)).toContain(SECRET);
  });

  it('loses everything when session storage is cleared, as on browser restart', async () => {
    await put(PLACEHOLDER, SECRET, CHAT_A);
    expect(await size()).toBe(1);

    await fakeBrowser.storage.session.clear();

    expect(await resolve(PLACEHOLDER, CHAT_A)).toBeNull();
    expect(await size()).toBe(0);
  });
});

describe('expiry', () => {
  /** Ages an entry by rewriting its lastAccessedAt directly in storage. */
  async function ageEntry(conversationId: string, placeholder: string, ms: number) {
    const stored = await fakeBrowser.storage.session.get('apa:vault');
    const map = stored['apa:vault'] as Record<
      string,
      { lastAccessedAt: number; createdAt: number }
    >;
    for (const record of Object.values(map)) {
      record.lastAccessedAt -= ms;
      record.createdAt -= ms;
    }
    await fakeBrowser.storage.session.set({ 'apa:vault': map });
  }

  it('does not return an entry past its lifetime', async () => {
    await put(PLACEHOLDER, SECRET, CHAT_A);
    await ageEntry(CHAT_A, PLACEHOLDER, TTL_MS + 1000);

    expect(await resolve(PLACEHOLDER, CHAT_A)).toBeNull();
  });

  it('filters expired entries from the count', async () => {
    // Expiry is a promise about what is retained, not merely about tidying up,
    // so it must hold on read even when no write has swept.
    await put(PLACEHOLDER, SECRET, CHAT_A);
    await ageEntry(CHAT_A, PLACEHOLDER, TTL_MS + 1000);

    expect(await size()).toBe(0);
    expect(await list()).toEqual([]);
  });

  it('keeps an entry that is still within its lifetime', async () => {
    await put(PLACEHOLDER, SECRET, CHAT_A);
    await ageEntry(CHAT_A, PLACEHOLDER, TTL_MS / 2);

    expect(await resolve(PLACEHOLDER, CHAT_A)).toBe(SECRET);
  });

  it('slides the expiry forward on access', async () => {
    // A conversation someone is actively working in keeps re-resolving the
    // same placeholders and must stay hydrated; a fixed lifetime would break
    // re-hydration mid-task, which is when it matters most.
    await put(PLACEHOLDER, SECRET, CHAT_A);
    await ageEntry(CHAT_A, PLACEHOLDER, TTL_MS - 1000);

    expect(await resolve(PLACEHOLDER, CHAT_A)).toBe(SECRET);

    // The read above should have reset the clock.
    await ageEntry(CHAT_A, PLACEHOLDER, TTL_MS - 1000);
    expect(await resolve(PLACEHOLDER, CHAT_A)).toBe(SECRET);
  });
});

describe('diagnostics', () => {
  it('reports the entry count', async () => {
    await put('[REDACTED_A_1]', 'a', CHAT_A);
    await put('[REDACTED_B_1]', 'b', CHAT_B);
    expect(await size()).toBe(2);
  });

  it('lists entries without exposing their values', async () => {
    // The popup shows what is held so the user can see it and clear it. It
    // must not become another surface that displays secrets.
    await put(PLACEHOLDER, SECRET, CHAT_A);

    const entries = await list();
    expect(entries).toHaveLength(1);
    expect(entries[0]!.placeholder).toBe(PLACEHOLDER);
    expect(entries[0]!.conversationId).toBe(CHAT_A);
    expect(JSON.stringify(entries)).not.toContain(SECRET);
  });
});

describe('resilience', () => {
  it('reports empty when session storage is unavailable', async () => {
    // A vault that cannot be read means no re-hydration — never a broken page.
    const original = fakeBrowser.storage.session.get;
    fakeBrowser.storage.session.get = () => Promise.reject(new Error('unavailable'));

    expect(await resolve(PLACEHOLDER, CHAT_A)).toBeNull();
    expect(await size()).toBe(0);

    fakeBrowser.storage.session.get = original;
  });

  it('does not throw when a write fails', async () => {
    const original = fakeBrowser.storage.session.set;
    fakeBrowser.storage.session.set = () => Promise.reject(new Error('quota'));

    await expect(put(PLACEHOLDER, SECRET, CHAT_A)).resolves.toBeUndefined();

    fakeBrowser.storage.session.set = original;
  });

  it('tolerates a corrupted stored value', async () => {
    await fakeBrowser.storage.session.set({ 'apa:vault': 'not an object' });
    expect(await resolve(PLACEHOLDER, CHAT_A)).toBeNull();
  });
});
