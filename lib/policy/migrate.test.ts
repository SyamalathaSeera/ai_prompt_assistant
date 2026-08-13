import { describe, expect, it } from 'vitest';
import { coerceSettings, migrateSettings, needsMigration } from './migrate';
import { DEFAULT_SETTINGS, SCHEMA_VERSION } from './defaults';

/**
 * Migration tests.
 *
 * The governing rule: never lose a user's configuration. Someone who turned
 * off a noisy rule family months ago must not find it back on after an update.
 */

describe('coercing stored values', () => {
  it('returns defaults for a missing value', () => {
    expect(coerceSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(coerceSettings(null)).toEqual(DEFAULT_SETTINGS);
  });

  it('returns defaults for a value of the wrong type', () => {
    expect(coerceSettings('not settings')).toEqual(DEFAULT_SETTINGS);
    expect(coerceSettings([1, 2, 3])).toEqual(DEFAULT_SETTINGS);
  });

  it('preserves a valid stored setting', () => {
    const result = coerceSettings({
      schemaVersion: SCHEMA_VERSION,
      enabled: false,
      highTierBehavior: 'warn',
    });

    expect(result.enabled).toBe(false);
    expect(result.highTierBehavior).toBe('warn');
  });

  it('rejects a boolean stored as a string', () => {
    // `"false"` is truthy, so a naive spread would silently invert the user's
    // intent — surfacing months later as "it stopped protecting me".
    const result = coerceSettings({ enabled: 'false' });
    expect(result.enabled).toBe(DEFAULT_SETTINGS.enabled);
  });

  it('rejects an unknown enum value', () => {
    const result = coerceSettings({ highTierBehavior: 'explode' });
    expect(result.highTierBehavior).toBe(DEFAULT_SETTINGS.highTierBehavior);
  });

  it('keeps an explicitly empty list rather than restoring defaults', () => {
    // A user who has re-enabled every rule stores an empty list. Treating that
    // as "unset" would turn their rules back off on the next read.
    const result = coerceSettings({ disabledRuleIds: [] });
    expect(result.disabledRuleIds).toEqual([]);
    expect(result.disabledRuleIds).not.toEqual(DEFAULT_SETTINGS.disabledRuleIds);
  });

  it('filters non-strings out of a list rather than discarding it', () => {
    const result = coerceSettings({ disabledRuleIds: ['pii.ipv4', 42, null, 'pii.ssn'] });
    expect(result.disabledRuleIds).toEqual(['pii.ipv4', 'pii.ssn']);
  });

  it('falls back per field, not wholesale', () => {
    // Losing one setting is much better than losing all of them.
    const result = coerceSettings({
      enabled: false,
      highTierBehavior: 'nonsense',
      pausedHosts: ['chatgpt.com'],
    });

    expect(result.enabled).toBe(false);
    expect(result.highTierBehavior).toBe(DEFAULT_SETTINGS.highTierBehavior);
    expect(result.pausedHosts).toEqual(['chatgpt.com']);
  });

  it('drops unknown fields', () => {
    const result = coerceSettings({ enabled: true, somethingRemoved: 'x' });
    expect(result).not.toHaveProperty('somethingRemoved');
  });

  it('always stamps the current schema version', () => {
    expect(coerceSettings({ schemaVersion: 0 }).schemaVersion).toBe(SCHEMA_VERSION);
  });
});

describe('migrating', () => {
  it('leaves current-version settings intact', () => {
    const stored = { ...DEFAULT_SETTINGS, enabled: false, pausedHosts: ['chatgpt.com'] };
    const result = migrateSettings(stored);

    expect(result.enabled).toBe(false);
    expect(result.pausedHosts).toEqual(['chatgpt.com']);
  });

  it('preserves user choices from an unversioned value', () => {
    const result = migrateSettings({
      enabled: false,
      disabledRuleIds: ['pii.ipv4'],
    });

    expect(result.enabled).toBe(false);
    expect(result.disabledRuleIds).toEqual(['pii.ipv4']);
    expect(result.schemaVersion).toBe(SCHEMA_VERSION);
  });

  it('keeps what it understands from a newer version', () => {
    // Happens when a profile syncs from a machine on a later release.
    // Discarding the configuration would be worse than ignoring fields we do
    // not recognise.
    const result = migrateSettings({
      schemaVersion: SCHEMA_VERSION + 5,
      enabled: false,
      futureSetting: 'whatever',
    });

    expect(result.enabled).toBe(false);
    expect(result.schemaVersion).toBe(SCHEMA_VERSION);
  });

  it('survives a corrupted value', () => {
    expect(migrateSettings('garbage')).toEqual(DEFAULT_SETTINGS);
  });
});

describe('v1 to v2: allowlist gained labels and dates', () => {
  // The first real migration. Everything below describes a transition that
  // will run on machines that already have v1 settings stored.

  it('carries every hash across, so nothing stops being suppressed', () => {
    const result = migrateSettings({
      schemaVersion: 1,
      allowlistHashes: ['hash-one', 'hash-two'],
    });

    expect(result.allowlist.map((e) => e.hash)).toEqual(['hash-one', 'hash-two']);
  });

  it('marks entries whose origin cannot be recovered', () => {
    // The label and date did not exist in v1. Inventing a plausible-looking
    // origin would be worse than admitting we do not know.
    const result = migrateSettings({ schemaVersion: 1, allowlistHashes: ['hash-one'] });

    expect(result.allowlist[0]!.label).toBe('Allowlisted value');
    expect(result.allowlist[0]!.addedAt).toBe('');
  });

  it('preserves other settings through the upgrade', () => {
    const result = migrateSettings({
      schemaVersion: 1,
      enabled: false,
      disabledRuleIds: ['pii.ipv4'],
      allowlistHashes: ['hash-one'],
    });

    expect(result.enabled).toBe(false);
    expect(result.disabledRuleIds).toEqual(['pii.ipv4']);
    expect(result.schemaVersion).toBe(SCHEMA_VERSION);
  });

  it('handles a v1 value with no allowlist at all', () => {
    const result = migrateSettings({ schemaVersion: 1, enabled: false });
    expect(result.allowlist).toEqual([]);
    expect(result.enabled).toBe(false);
  });

  it('is idempotent — migrating twice changes nothing', () => {
    const once = migrateSettings({ schemaVersion: 1, allowlistHashes: ['hash-one'] });
    expect(migrateSettings(once)).toEqual(once);
  });
});

describe('allowlist coercion', () => {
  it('drops entries with no usable hash', () => {
    // The hash is what suppresses a finding; an entry without one does nothing.
    const result = coerceSettings({
      allowlist: [{ hash: 'good', label: 'X', addedAt: '2026-08-13' }, { label: 'no hash' }],
    });

    expect(result.allowlist).toHaveLength(1);
    expect(result.allowlist[0]!.hash).toBe('good');
  });

  it('defaults cosmetic fields rather than discarding the suppression', () => {
    const result = coerceSettings({ allowlist: [{ hash: 'good' }] });

    expect(result.allowlist[0]!.label).toBe('Allowlisted value');
    expect(result.allowlist[0]!.addedAt).toBe('');
  });
});

describe('needsMigration', () => {
  it('is true for anything unversioned or wrong-versioned', () => {
    expect(needsMigration(undefined)).toBe(true);
    expect(needsMigration({})).toBe(true);
    expect(needsMigration({ schemaVersion: 0 })).toBe(true);
  });

  it('is false at the current version', () => {
    expect(needsMigration({ schemaVersion: SCHEMA_VERSION })).toBe(false);
  });
});
