import { connectVaultForTests } from '../vault/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import {
  __resetCacheForTests,
  countRecent,
  deleteAllData,
  getCounters,
  getSettings,
  getSettingsSync,
  initSettings,
  onSettingsChanged,
  recordCatch,
  setSettings,
} from './index';
import { DEFAULT_SETTINGS } from '../policy/defaults';

const SETTINGS_KEY = 'apa:settings';
const COUNTERS_KEY = 'apa:counters';

beforeEach(() => {
  fakeBrowser.reset();
  connectVaultForTests();
  __resetCacheForTests();
});

describe('reading settings', () => {
  it('returns defaults on a fresh install', async () => {
    expect(await getSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('returns what was stored', async () => {
    await fakeBrowser.storage.local.set({
      [SETTINGS_KEY]: { ...DEFAULT_SETTINGS, enabled: false },
    });

    expect((await getSettings()).enabled).toBe(false);
  });

  it('repairs a corrupted stored value instead of failing', async () => {
    await fakeBrowser.storage.local.set({ [SETTINGS_KEY]: 'not settings' });
    expect(await getSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('falls back to defaults when storage is unavailable', async () => {
    // A user with broken storage should still be protected.
    const original = fakeBrowser.storage.local.get;
    fakeBrowser.storage.local.get = () => Promise.reject(new Error('unavailable'));

    expect(await getSettings()).toEqual(DEFAULT_SETTINGS);

    fakeBrowser.storage.local.get = original;
  });
});

describe('the synchronous view', () => {
  it('returns defaults before the first load', () => {
    // The safe direction: defaults have protection enabled.
    expect(getSettingsSync()).toEqual(DEFAULT_SETTINGS);
  });

  it('reflects settings once loaded', async () => {
    await fakeBrowser.storage.local.set({
      [SETTINGS_KEY]: { ...DEFAULT_SETTINGS, enabled: false },
    });
    await getSettings();

    expect(getSettingsSync().enabled).toBe(false);
  });

  it('is what the interception path needs, since detect() is synchronous', async () => {
    await setSettings({ highTierBehavior: 'warn' });
    expect(getSettingsSync().highTierBehavior).toBe('warn');
  });
});

describe('writing settings', () => {
  it('applies a partial update without disturbing the rest', async () => {
    await setSettings({ enabled: false });
    const settings = await getSettings();

    expect(settings.enabled).toBe(false);
    expect(settings.scanOnPaste).toBe(DEFAULT_SETTINGS.scanOnPaste);
    expect(settings.disabledRuleIds).toEqual(DEFAULT_SETTINGS.disabledRuleIds);
  });

  it('accumulates successive updates', async () => {
    await setSettings({ enabled: false });
    await setSettings({ scanOnPaste: false });

    const settings = await getSettings();
    expect(settings.enabled).toBe(false);
    expect(settings.scanOnPaste).toBe(false);
  });

  it('persists to storage.local, never .sync', async () => {
    await setSettings({ enabled: false });

    expect((await fakeBrowser.storage.local.get(SETTINGS_KEY))[SETTINGS_KEY]).toBeDefined();
    expect(await fakeBrowser.storage.sync.get(null)).toEqual({});
  });

  it('keeps the user’s intent for the session when a write fails', async () => {
    const original = fakeBrowser.storage.local.set;
    fakeBrowser.storage.local.set = () => Promise.reject(new Error('quota'));

    await setSettings({ enabled: false });
    expect(getSettingsSync().enabled).toBe(false);

    fakeBrowser.storage.local.set = original;
  });
});

describe('change notification', () => {
  it('reports a change made elsewhere', async () => {
    // An open ChatGPT tab must pick up a settings change without a reload.
    const seen: boolean[] = [];
    const dispose = onSettingsChanged((s) => seen.push(s.enabled));

    await fakeBrowser.storage.local.set({
      [SETTINGS_KEY]: { ...DEFAULT_SETTINGS, enabled: false },
    });

    await vi.waitFor(() => expect(seen).toContain(false));
    dispose();
  });

  it('updates the synchronous view too', async () => {
    const dispose = onSettingsChanged(() => {});

    await fakeBrowser.storage.local.set({
      [SETTINGS_KEY]: { ...DEFAULT_SETTINGS, enabled: false },
    });

    await vi.waitFor(() => expect(getSettingsSync().enabled).toBe(false));
    dispose();
  });

  it('ignores unrelated keys', async () => {
    const cb = vi.fn();
    const dispose = onSettingsChanged(cb);

    await fakeBrowser.storage.local.set({ 'something:else': 1 });
    await new Promise((r) => setTimeout(r, 10));

    expect(cb).not.toHaveBeenCalled();
    dispose();
  });

  it('survives a throwing listener', async () => {
    const dispose = onSettingsChanged(() => {
      throw new Error('boom');
    });

    await expect(
      fakeBrowser.storage.local.set({ [SETTINGS_KEY]: DEFAULT_SETTINGS }),
    ).resolves.toBeUndefined();

    dispose();
  });

  it('stops after dispose', async () => {
    const cb = vi.fn();
    onSettingsChanged(cb)();

    await fakeBrowser.storage.local.set({ [SETTINGS_KEY]: DEFAULT_SETTINGS });
    await new Promise((r) => setTimeout(r, 10));

    expect(cb).not.toHaveBeenCalled();
  });

  it('initSettings loads and then watches', async () => {
    await fakeBrowser.storage.local.set({
      [SETTINGS_KEY]: { ...DEFAULT_SETTINGS, enabled: false },
    });

    const seen: boolean[] = [];
    const dispose = await initSettings((s) => seen.push(s.scanOnPaste));

    expect(getSettingsSync().enabled).toBe(false);

    await fakeBrowser.storage.local.set({
      [SETTINGS_KEY]: { ...DEFAULT_SETTINGS, scanOnPaste: false },
    });
    await vi.waitFor(() => expect(seen).toContain(false));

    dispose();
  });
});

describe('counters', () => {
  it('starts at zero', async () => {
    const counters = await getCounters();
    expect(counters.totalCatches).toBe(0);
    expect(counters.byRule).toEqual({});
  });

  it('counts a catch by rule and by day', async () => {
    await recordCatch('aws.access_key_id');
    await recordCatch('aws.access_key_id');
    await recordCatch('stripe.live_key');

    const counters = await getCounters();
    expect(counters.totalCatches).toBe(3);
    expect(counters.byRule['aws.access_key_id']).toBe(2);
    expect(counters.byRule['stripe.live_key']).toBe(1);
    expect(Object.values(counters.byDay)).toEqual([3]);
  });

  it('records the rule id and nothing else', async () => {
    // This is the retention surface, not a log of what the user was working on.
    await recordCatch('aws.access_key_id');

    const stored = await fakeBrowser.storage.local.get(COUNTERS_KEY);
    const serialized = JSON.stringify(stored);

    expect(serialized).toContain('aws.access_key_id');
    expect(serialized).not.toMatch(/AKIA|sk_live|postgres:\/\//);
  });

  it('answers "how many recently"', async () => {
    await recordCatch('aws.access_key_id');
    await recordCatch('stripe.live_key');

    expect(await countRecent(7)).toBe(2);
  });

  it('excludes days outside the window', async () => {
    await fakeBrowser.storage.local.set({
      [COUNTERS_KEY]: {
        totalCatches: 5,
        byRule: {},
        byDay: { '2020-01-01': 4, [new Date().toISOString().slice(0, 10)]: 1 },
        installedAt: '2020-01-01',
      },
    });

    expect(await countRecent(7)).toBe(1);
  });

  it('never throws, even when storage fails', async () => {
    const original = fakeBrowser.storage.local.set;
    fakeBrowser.storage.local.set = () => Promise.reject(new Error('quota'));

    await expect(recordCatch('aws.access_key_id')).resolves.toBeUndefined();

    fakeBrowser.storage.local.set = original;
  });
});

describe('deleteAllData', () => {
  it('removes settings, counters, and the vault', async () => {
    await setSettings({ enabled: false });
    await recordCatch('aws.access_key_id');
    await fakeBrowser.storage.session.set({ 'apa:vault': { x: 1 } });

    await deleteAllData();

    expect(await fakeBrowser.storage.local.get(SETTINGS_KEY)).toEqual({});
    expect(await fakeBrowser.storage.local.get(COUNTERS_KEY)).toEqual({});
    expect(await fakeBrowser.storage.session.get(null)).toEqual({});
  });

  it('leaves storage belonging to others alone', async () => {
    // Clearing storage wholesale would not be ours to do.
    await fakeBrowser.storage.local.set({ 'someone-else': 'data' });

    await deleteAllData();

    expect((await fakeBrowser.storage.local.get('someone-else'))['someone-else']).toBe(
      'data',
    );
  });

  it('resets to defaults afterwards', async () => {
    await setSettings({ enabled: false });
    await deleteAllData();

    expect(await getSettings()).toEqual(DEFAULT_SETTINGS);
  });
});
