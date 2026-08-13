import { DEFAULT_SETTINGS, SCHEMA_VERSION } from './defaults';
import type { AllowlistEntry, Settings } from './schema';

/**
 * Settings migration.
 *
 * Written before there is anything to migrate, which is the only time it is
 * cheap. Once users have stored settings, adding this retroactively means
 * guessing at shapes that already exist in the wild.
 *
 * The governing rule: **never lose a user's configuration.** Someone who
 * turned off a noisy rule family six months ago should not find it back on
 * after an update — they would conclude the extension had reset itself, and
 * they would be right.
 */

/** A stored value of unknown vintage. */
type StoredSettings = Partial<Settings> & { schemaVersion?: number };

/**
 * Per-version upgrade steps.
 *
 * Each entry takes settings at version N and returns version N+1. Add a step
 * when the shape changes; never edit an existing one, since it describes a
 * transition that has already run on real machines.
 */
const STEPS: Record<number, (settings: StoredSettings) => StoredSettings> = {
  /**
   * 1 -> 2: `allowlistHashes: string[]` became `allowlist: AllowlistEntry[]`.
   *
   * The hashes are what matter and they carry over exactly, so nothing the
   * user allowlisted stops being suppressed. The label and date did not exist
   * before and cannot be recovered — the entry is marked as such rather than
   * inventing a plausible-looking origin for it.
   */
  1: (settings) => {
    const legacy = (settings as { allowlistHashes?: unknown }).allowlistHashes;
    const hashes = Array.isArray(legacy)
      ? legacy.filter((h): h is string => typeof h === 'string')
      : [];

    return {
      ...settings,
      allowlist: hashes.map((hash) => ({
        hash,
        label: 'Allowlisted value',
        addedAt: '',
      })),
      schemaVersion: 2,
    };
  },
};

/** Whether a value is a plain object we can read fields from. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Keeps a stored array only if every element is a string. */
function stringArray(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback;
  return value.filter((item): item is string => typeof item === 'string');
}

function boolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

/**
 * Keeps allowlist entries that still have a usable hash.
 *
 * The hash is what suppresses a finding, so an entry without one does nothing
 * and is dropped. Label and date are cosmetic and are defaulted rather than
 * being grounds for discarding a suppression the user asked for.
 */
function allowlistEntries(value: unknown): AllowlistEntry[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((item) => {
    if (!isRecord(item)) return [];
    if (typeof item.hash !== 'string' || item.hash === '') return [];

    return [
      {
        hash: item.hash,
        label: typeof item.label === 'string' ? item.label : 'Allowlisted value',
        addedAt: typeof item.addedAt === 'string' ? item.addedAt : '',
      },
    ];
  });
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

/**
 * Coerces an arbitrary stored value into valid `Settings`.
 *
 * Field-by-field rather than a spread over defaults, so a corrupted or
 * partially-written value cannot inject a wrong type into the running
 * extension. A boolean setting arriving as the string `"false"` would be
 * truthy and silently invert the user's intent — the kind of bug that shows up
 * as "it stopped protecting me" months later.
 *
 * Unknown fields are dropped. A field that fails validation falls back to its
 * default rather than rejecting the whole object: losing one setting is much
 * better than losing all of them.
 */
export function coerceSettings(stored: unknown): Settings {
  if (!isRecord(stored)) return { ...DEFAULT_SETTINGS };

  return {
    schemaVersion: SCHEMA_VERSION,
    enabled: boolean(stored.enabled, DEFAULT_SETTINGS.enabled),
    highTierBehavior: oneOf(
      stored.highTierBehavior,
      ['block', 'warn'] as const,
      DEFAULT_SETTINGS.highTierBehavior,
    ),
    placeholderStyle: oneOf(
      stored.placeholderStyle,
      ['bracketed', 'dummy'] as const,
      DEFAULT_SETTINGS.placeholderStyle,
    ),
    scanOnPaste: boolean(stored.scanOnPaste, DEFAULT_SETTINGS.scanOnPaste),
    rehydrateResponses: boolean(
      stored.rehydrateResponses,
      DEFAULT_SETTINGS.rehydrateResponses,
    ),
    // Note the empty-array fallbacks: a user who has turned every rule back ON
    // stores an empty list, which must not be mistaken for "unset" and
    // replaced with the defaults.
    disabledRuleIds: stringArray(stored.disabledRuleIds, []),
    allowlist: allowlistEntries(stored.allowlist),
    pausedHosts: stringArray(stored.pausedHosts, []),
    pausedUntil:
      typeof stored.pausedUntil === 'number' && Number.isFinite(stored.pausedUntil)
        ? stored.pausedUntil
        : null,
  };
}

/**
 * Brings stored settings up to the current schema version.
 *
 * Runs the ordered upgrade steps, then coerces the result. Settings from a
 * NEWER version than this build are coerced but not downgraded — that happens
 * when someone syncs a profile from a machine running a later release, and
 * silently discarding their configuration would be worse than ignoring fields
 * we do not understand.
 */
export function migrateSettings(stored: unknown): Settings {
  if (!isRecord(stored)) return { ...DEFAULT_SETTINGS };

  let working: StoredSettings = stored as StoredSettings;
  let version = typeof working.schemaVersion === 'number' ? working.schemaVersion : 0;

  while (version < SCHEMA_VERSION) {
    const step = STEPS[version];
    if (!step) break;
    working = step(working);
    version += 1;
  }

  return coerceSettings(working);
}

/** Whether a stored value would change if migrated — i.e. needs writing back. */
export function needsMigration(stored: unknown): boolean {
  if (!isRecord(stored)) return true;
  return stored.schemaVersion !== SCHEMA_VERSION;
}
