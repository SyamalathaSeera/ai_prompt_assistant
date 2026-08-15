import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { badgeTextFor, refreshBadge, watchCounters } from './index';
import { __resetCacheForTests, recordCatch } from '../storage';

/**
 * The toolbar badge.
 *
 * The only surface that answers "is this thing doing anything" without the user
 * opening something, so its failure mode is not a wrong number — it is a badge
 * that stops updating and quietly becomes a lie about a working extension.
 */

beforeEach(() => {
  fakeBrowser.reset();
  __resetCacheForTests();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('what the badge says', () => {
  it('shows nothing when nothing has been caught', () => {
    // An empty badge is the honest state. A zero would be a number that means
    // "no", which reads as a number that means "some".
    expect(badgeTextFor(0)).toBe('');
  });

  it('shows the count', () => {
    expect(badgeTextFor(1)).toBe('1');
    expect(badgeTextFor(37)).toBe('37');
  });

  it('caps at 99+', () => {
    // Chrome truncates past about four characters, and the difference between
    // 100 and 137 is not one the user acts on.
    expect(badgeTextFor(100)).toBe('99+');
    expect(badgeTextFor(5000)).toBe('99+');
  });

  it('refuses nonsense rather than rendering it', () => {
    expect(badgeTextFor(-1)).toBe('');
    expect(badgeTextFor(Number.NaN)).toBe('');
    expect(badgeTextFor(Number.POSITIVE_INFINITY)).toBe('');
  });
});

describe('keeping it current', () => {
  it('updates when a catch is recorded', async () => {
    const setBadgeText = vi.fn();
    // @ts-expect-error the fake browser has no action namespace by default
    fakeBrowser.action = { setBadgeText, setBadgeBackgroundColor: vi.fn() };

    const stop = watchCounters();
    await recordCatch('aws.access_key_id');

    // The listener fires on the storage write; give the async refresh a turn.
    await vi.waitFor(() => expect(setBadgeText).toHaveBeenCalled());
    expect(setBadgeText).toHaveBeenLastCalledWith({ text: '1' });

    stop();
  });

  it('counts a recent window, not a lifetime total', async () => {
    /*
     * A lifetime number stops moving and becomes wallpaper. "3 this week" is a
     * fact about now, and it returns to nothing when the extension has genuinely
     * done nothing — which is the honesty that makes the number worth trusting.
     */
    const setBadgeText = vi.fn();
    // @ts-expect-error see above
    fakeBrowser.action = { setBadgeText, setBadgeBackgroundColor: vi.fn() };

    // A catch from long ago, written directly so it carries an old date.
    await fakeBrowser.storage.local.set({
      'apa:counters': {
        totalCatches: 9,
        byRule: { 'aws.access_key_id': 9 },
        byDay: { '2020-01-01': 9 },
        installedAt: '2020-01-01',
      },
    });

    await refreshBadge();

    expect(setBadgeText).toHaveBeenLastCalledWith({ text: '' });
  });

  it('ignores writes to other keys', async () => {
    const setBadgeText = vi.fn();
    // @ts-expect-error see above
    fakeBrowser.action = { setBadgeText, setBadgeBackgroundColor: vi.fn() };

    const stop = watchCounters();
    await fakeBrowser.storage.local.set({ 'apa:settings': { schemaVersion: 2 } });
    await new Promise((resolve) => setTimeout(resolve, 20));

    // Otherwise every settings toggle would cost a storage read.
    expect(setBadgeText).not.toHaveBeenCalled();
    stop();
  });

  it('stops listening when disposed', async () => {
    const setBadgeText = vi.fn();
    // @ts-expect-error see above
    fakeBrowser.action = { setBadgeText, setBadgeBackgroundColor: vi.fn() };

    const stop = watchCounters();
    stop();

    await recordCatch('aws.access_key_id');
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(setBadgeText).not.toHaveBeenCalled();
  });
});

describe('never becoming the fault', () => {
  it('does not throw when the action API is missing', async () => {
    // Firefox, an older Chrome, or a context where `action` is unavailable.
    // @ts-expect-error deliberately removing it
    fakeBrowser.action = undefined;

    await expect(refreshBadge()).resolves.toBeUndefined();
  });

  it('does not throw when setting the badge fails', async () => {
    // @ts-expect-error see above
    fakeBrowser.action = {
      setBadgeText: () => Promise.reject(new Error('no')),
      setBadgeBackgroundColor: vi.fn(),
    };

    await expect(refreshBadge()).resolves.toBeUndefined();
  });
});
