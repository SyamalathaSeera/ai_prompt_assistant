import { beforeEach, describe, expect, it, vi } from 'vitest';
import { detectTheme, observeTheme } from './theme';

/** jsdom has no real matchMedia; this fakes one we can drive. */
function stubPrefersDark(dark: boolean) {
  const listeners = new Set<() => void>();
  const mql = {
    matches: dark,
    addEventListener: (_: string, cb: () => void) => listeners.add(cb),
    removeEventListener: (_: string, cb: () => void) => listeners.delete(cb),
  };
  vi.stubGlobal('matchMedia', () => mql);
  return {
    set: (value: boolean) => {
      mql.matches = value;
      listeners.forEach((cb) => cb());
    },
  };
}

beforeEach(() => {
  vi.unstubAllGlobals();
  document.documentElement.className = '';
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('style');
});

describe('detectTheme', () => {
  it('prefers the host page over the OS setting', () => {
    // A user in dark-mode ChatGPT on a light-themed OS must not get a bright
    // white panel floating over a dark chat.
    stubPrefersDark(false);
    document.documentElement.classList.add('dark');

    expect(detectTheme()).toBe('dark');
  });

  it('reads data-theme', () => {
    stubPrefersDark(false);
    document.documentElement.setAttribute('data-theme', 'dark');
    expect(detectTheme()).toBe('dark');
  });

  it('reads an explicit light class over a dark OS preference', () => {
    stubPrefersDark(true);
    document.documentElement.classList.add('light');
    expect(detectTheme()).toBe('light');
  });

  it('reads the color-scheme style property', () => {
    stubPrefersDark(false);
    document.documentElement.style.colorScheme = 'dark';
    expect(detectTheme()).toBe('dark');
  });

  it('falls back to the OS preference when the host says nothing', () => {
    stubPrefersDark(true);
    expect(detectTheme()).toBe('dark');

    stubPrefersDark(false);
    expect(detectTheme()).toBe('light');
  });

  it('defaults to light when matchMedia is unavailable', () => {
    vi.stubGlobal('matchMedia', undefined);
    expect(detectTheme()).toBe('light');
  });

  it('does not throw when matchMedia throws', () => {
    vi.stubGlobal('matchMedia', () => {
      throw new Error('blocked');
    });
    expect(() => detectTheme()).not.toThrow();
    expect(detectTheme()).toBe('light');
  });
});

describe('observeTheme', () => {
  it('reports when the host page switches theme', async () => {
    stubPrefersDark(false);
    const onChange = vi.fn();
    const dispose = observeTheme(onChange);

    document.documentElement.classList.add('dark');
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledWith('dark'));

    dispose();
  });

  it('reports when the OS preference changes', () => {
    const media = stubPrefersDark(false);
    const onChange = vi.fn();
    const dispose = observeTheme(onChange);

    media.set(true);

    expect(onChange).toHaveBeenCalledWith('dark');
    dispose();
  });

  it('ignores unrelated attribute churn', async () => {
    // Host pages mutate <html> constantly; re-rendering on each would be waste.
    stubPrefersDark(false);
    const onChange = vi.fn();
    const dispose = observeTheme(onChange);

    document.documentElement.classList.add('some-unrelated-class');
    document.documentElement.classList.add('another-one');
    await new Promise((r) => setTimeout(r, 10));

    expect(onChange).not.toHaveBeenCalled();
    dispose();
  });

  it('does not fire when the theme is set to what it already was', async () => {
    stubPrefersDark(false);
    document.documentElement.classList.add('light');
    const onChange = vi.fn();
    const dispose = observeTheme(onChange);

    document.documentElement.setAttribute('data-theme', 'light');
    await new Promise((r) => setTimeout(r, 10));

    expect(onChange).not.toHaveBeenCalled();
    dispose();
  });

  it('stops reporting after dispose', async () => {
    stubPrefersDark(false);
    const onChange = vi.fn();
    observeTheme(onChange)();

    document.documentElement.classList.add('dark');
    await new Promise((r) => setTimeout(r, 10));

    expect(onChange).not.toHaveBeenCalled();
  });
});
