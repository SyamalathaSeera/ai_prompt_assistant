import { clearSession } from '../vault';
import { browser } from 'wxt/browser';
import { COUNTER_HISTORY_DAYS, DEFAULT_COUNTERS, DEFAULT_SETTINGS } from '../policy/defaults';
import { migrateSettings } from '../policy/migrate';
import type { Counters, Settings } from '../policy/schema';

/**
 * Typed wrappers over `chrome.storage.local`.
 *
 * Storage split (ADR-005):
 *   .local   settings, allowlist hashes, counters   — persistent
 *   .session vault (real values)                    — memory-backed, see lib/vault
 *
 * Never write a secret value here. Never use `.sync` for anything sensitive:
 * it leaves the device, which would contradict the product's core claim. The
 * allowlist stores SHA-256 hashes, never plaintext — see lib/policy/allowlist.
 */

const SETTINGS_KEY = 'apa:settings';
const COUNTERS_KEY = 'apa:counters';

/**
 * Per-host protection health.
 *
 * `.session`, not `.local`: it describes the page as it is right now, and a
 * stale "protection unavailable" surviving a browser restart would be a lie in
 * the more dangerous direction — or, worse, a stale "healthy" would.
 *
 * Records a level and the name of the strategy that resolved. **No URL, no
 * prompt content, no page text** — the host is already implied by which tab the
 * popup is looking at, and nothing here is transmitted anywhere regardless.
 */
const HEALTH_KEY = 'apa:health';

/**
 * Synchronous view of settings, kept current by the change listener.
 *
 * The interception path runs on every submission and cannot await storage:
 * `detect()` is synchronous by design (ADR-004), and making the submit handler
 * async would mean the prompt is already gone by the time settings arrive.
 * So settings are read once, cached, and refreshed on change.
 */
let cached: Settings | null = null;

/** Reads settings, migrating and repairing whatever is stored. */
export async function getSettings(): Promise<Settings> {
  try {
    const stored = await browser.storage.local.get(SETTINGS_KEY);
    const settings = migrateSettings(stored[SETTINGS_KEY]);
    cached = settings;
    return settings;
  } catch {
    // Storage unavailable: fall back to defaults rather than failing. A user
    // with broken storage should still be protected.
    cached = { ...DEFAULT_SETTINGS };
    return cached;
  }
}

/**
 * The last known settings without awaiting storage.
 *
 * Returns defaults until the first load completes — the safe direction, since
 * defaults have protection enabled.
 */
export function getSettingsSync(): Settings {
  return cached ?? DEFAULT_SETTINGS;
}

/** Applies a partial update, preserving everything else. */
export async function setSettings(patch: Partial<Settings>): Promise<Settings> {
  const current = await getSettings();
  const next: Settings = { ...current, ...patch };

  try {
    await browser.storage.local.set({ [SETTINGS_KEY]: next });
    cached = next;
  } catch {
    /* the in-memory value still reflects the user's intent for this session */
    cached = next;
  }

  return next;
}

/**
 * Subscribes to settings changes.
 *
 * Fires for changes made anywhere — the options page, the popup, another
 * window — so an open ChatGPT tab picks up a new setting without a reload.
 * Returns a disposer.
 */
export function onSettingsChanged(cb: (settings: Settings) => void): () => void {
  const listener = (
    changes: Record<string, { newValue?: unknown }>,
    areaName: string,
  ) => {
    if (areaName !== 'local') return;
    const change = changes[SETTINGS_KEY];
    if (!change) return;

    const settings = migrateSettings(change.newValue);
    cached = settings;
    try {
      cb(settings);
    } catch {
      /* a listener throwing must not break storage for everyone else */
    }
  };

  browser.storage.onChanged.addListener(listener);
  return () => browser.storage.onChanged.removeListener(listener);
}

/** Loads settings into the cache and keeps them current. Returns a disposer. */
export async function initSettings(
  onChange?: (settings: Settings) => void,
): Promise<() => void> {
  await getSettings();
  return onSettingsChanged((settings) => onChange?.(settings));
}

/** `YYYY-MM-DD` in local time — the day the user experienced, not UTC's. */
function today(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Drops history beyond the retention window. */
function trimHistory(byDay: Record<string, number>): Record<string, number> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - COUNTER_HISTORY_DAYS);
  const cutoffKey = today(cutoff);

  return Object.fromEntries(Object.entries(byDay).filter(([day]) => day >= cutoffKey));
}

export async function getCounters(): Promise<Counters> {
  try {
    const stored = await browser.storage.local.get(COUNTERS_KEY);
    const value = stored[COUNTERS_KEY];
    if (typeof value !== 'object' || value === null) return { ...DEFAULT_COUNTERS };

    const counters = value as Partial<Counters>;
    return {
      totalCatches:
        typeof counters.totalCatches === 'number' ? counters.totalCatches : 0,
      byRule: typeof counters.byRule === 'object' && counters.byRule ? counters.byRule : {},
      byDay: typeof counters.byDay === 'object' && counters.byDay ? counters.byDay : {},
      installedAt:
        typeof counters.installedAt === 'string' ? counters.installedAt : today(),
    };
  } catch {
    return { ...DEFAULT_COUNTERS };
  }
}

/**
 * Records a catch.
 *
 * Stores the rule id and the day — never the value, never the prompt. This is
 * the retention surface ("47 secrets caught"), and it must not become a log of
 * what the user was working on.
 */
export async function recordCatch(ruleId: string): Promise<void> {
  try {
    const counters = await getCounters();
    const day = today();

    const next: Counters = {
      totalCatches: counters.totalCatches + 1,
      byRule: { ...counters.byRule, [ruleId]: (counters.byRule[ruleId] ?? 0) + 1 },
      byDay: trimHistory({ ...counters.byDay, [day]: (counters.byDay[day] ?? 0) + 1 }),
      installedAt: counters.installedAt || day,
    };

    await browser.storage.local.set({ [COUNTERS_KEY]: next });
  } catch {
    /* a lost count is never worth disturbing the user */
  }
}

/** Catches within the last `days` days, inclusive of today. */
export async function countRecent(days: number): Promise<number> {
  const counters = await getCounters();
  const since = new Date();
  since.setDate(since.getDate() - (days - 1));
  const sinceKey = today(since);

  return Object.entries(counters.byDay)
    .filter(([day]) => day >= sinceKey)
    .reduce((sum, [, count]) => sum + count, 0);
}

/**
 * Deletes everything this extension has stored, in both areas.
 *
 * Backs the "delete everything" control the options page will offer. Scoped to
 * our own keys rather than clearing storage wholesale, which would not be ours
 * to do.
 */
export async function deleteAllData(): Promise<void> {
  try {
    await browser.storage.local.remove([SETTINGS_KEY, COUNTERS_KEY]);
  } catch {
    /* nothing further we can safely do */
  }
  try {
    await clearSession();
  } catch {
    /* likewise */
  }
  cached = null;
}

/**
 * What the popup needs to answer "am I protected on this page right now?".
 *
 * `level` mirrors `lib/health`'s, kept as a plain string so the storage layer
 * does not depend on the health module and vice versa.
 */
export interface StoredHealth {
  level: 'healthy' | 'degraded' | 'unavailable';
  /** Strategy that resolved the composer, for diagnosis. Never transmitted. */
  resolvedVia: string | null;
  /** Epoch ms, so the popup can ignore a reading from a page long since gone. */
  at: number;
}

/**
 * Records how well protection is working on a host.
 *
 * Best-effort throughout. A failure to write health is not itself a protection
 * failure, and it must never propagate into the content script — reporting
 * that something is broken should not be able to break anything.
 */
export async function recordHealth(host: string, health: StoredHealth): Promise<void> {
  try {
    const stored = await browser.storage.session.get(HEALTH_KEY);
    const map = (stored[HEALTH_KEY] ?? {}) as Record<string, StoredHealth>;

    await browser.storage.session.set({
      [HEALTH_KEY]: { ...map, [host]: health },
    });
  } catch {
    /* health reporting is advisory; losing it costs a message, not protection */
  }
}

/** Reads the last recorded health for a host, or null if there is none. */
export async function getHealth(host: string): Promise<StoredHealth | null> {
  try {
    const stored = await browser.storage.session.get(HEALTH_KEY);
    const map = (stored[HEALTH_KEY] ?? {}) as Record<string, StoredHealth>;
    return map[host] ?? null;
  } catch {
    return null;
  }
}

/** Resets the in-memory cache. Test seam only. */
export function __resetCacheForTests(): void {
  cached = null;
}
