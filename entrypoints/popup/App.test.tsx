import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'preact';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import App from './App';
import { put, size } from '@/lib/vault';
import { __resetCacheForTests, getSettings, recordCatch, setSettings } from '@/lib/storage';
import { PAUSE_DURATION_MS } from '@/lib/policy/defaults';

const SECRET = 'AKIA3TZ2MRSYNTHETIC7';
const CHAT = 'conversation-a';

let container: HTMLElement;

const $ = (id: string) => container.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const waitFor = (assertion: () => void) => vi.waitFor(assertion, { timeout: 3000 });

/**
 * Puts a tab in the active slot so the popup can read its hostname.
 *
 * Cast through unknown: only `url` is read, and building a complete Tab would
 * be noise that obscures what the test is actually about.
 */
function withActiveTab(url: string): void {
  fakeBrowser.tabs.query = (() =>
    Promise.resolve([{ url, active: true }])) as unknown as typeof fakeBrowser.tabs.query;
}

function mount(): void {
  container = document.createElement('div');
  document.body.appendChild(container);
  render(<App />, container);
}

/** Waits for the initial async loads to land. */
const ready = () => waitFor(() => expect($('status')).not.toBeNull());

beforeEach(() => {
  fakeBrowser.reset();
  __resetCacheForTests();
  document.body.innerHTML = '';
  fakeBrowser.tabs.query = () => Promise.resolve([]);
});

describe('status', () => {
  it('reports protection on a supported tab', async () => {
    withActiveTab('https://chatgpt.com/c/abc');
    mount();

    await waitFor(() => expect($('status')!.textContent).toContain('Protecting this tab'));
    expect($('status-dot')!.getAttribute('data-active')).toBe('true');
  });

  it('reports when the extension is turned off', async () => {
    await setSettings({ enabled: false });
    mount();

    await waitFor(() => expect($('status')!.textContent).toContain('Turned off'));
    expect($('status-dot')!.getAttribute('data-active')).toBe('false');
  });

  it('reports a paused site', async () => {
    withActiveTab('https://chatgpt.com/');
    await setSettings({ pausedHosts: ['chatgpt.com'] });
    mount();

    await waitFor(() => expect($('status')!.textContent).toContain('Paused on chatgpt.com'));
  });

  it('reports how long a timed pause has left', async () => {
    await setSettings({ pausedUntil: Date.now() + 5 * 60_000 });
    mount();

    await waitFor(() => expect($('status')!.textContent).toMatch(/Paused for \d+ more minutes/));
  });

  it('treats an expired pause as active', async () => {
    // Compared against the clock rather than cleared by a timer, so it cannot
    // outlive its window because a service worker was asleep.
    await setSettings({ pausedUntil: Date.now() - 1000 });
    mount();

    await ready();
    expect($('status-dot')!.getAttribute('data-active')).toBe('true');
  });

  it('works when no tab information is available', async () => {
    // Without the `tabs` permission, an unsupported tab's URL is opaque to us.
    mount();
    await waitFor(() =>
      expect($('status')!.textContent).toContain('Active on supported AI chats'),
    );
  });
});

describe('catch counts', () => {
  it('starts at zero', async () => {
    mount();
    await waitFor(() => expect($('count-total')!.textContent).toBe('0'));
    expect($('count-week')!.textContent).toBe('0');
  });

  it('shows what has been caught', async () => {
    // The retention surface: a passive tool is invisible when it works, so a
    // user who never sees evidence concludes it does nothing.
    await recordCatch('aws.access_key_id');
    await recordCatch('stripe.live_key');
    mount();

    await waitFor(() => expect($('count-total')!.textContent).toBe('2'));
    expect($('count-week')!.textContent).toBe('2');
  });

  it('never shows what was caught, only how much', async () => {
    await recordCatch('aws.access_key_id');
    mount();

    await waitFor(() => expect($('count-total')!.textContent).toBe('1'));
    expect(container.textContent).not.toContain('AKIA');
  });
});

describe('pausing', () => {
  it('pauses for a fixed window', async () => {
    mount();
    await ready();

    $('pause-timed')!.click();

    await waitFor(() => expect($('status')!.textContent).toContain('Paused for'));
    const settings = await getSettings();
    expect(settings.pausedUntil).toBeGreaterThan(Date.now());
    expect(settings.pausedUntil).toBeLessThanOrEqual(Date.now() + PAUSE_DURATION_MS);
  });

  it('can be resumed before the window ends', async () => {
    await setSettings({ pausedUntil: Date.now() + PAUSE_DURATION_MS });
    mount();
    await waitFor(() => expect($('pause-resume')).not.toBeNull());

    $('pause-resume')!.click();

    await waitFor(() => expect($('pause-timed')).not.toBeNull());
    expect((await getSettings()).pausedUntil).toBeNull();
  });

  it('pauses a specific site', async () => {
    withActiveTab('https://chatgpt.com/');
    mount();
    await waitFor(() => expect($('pause-site')).not.toBeNull());

    $('pause-site')!.click();

    await waitFor(() => expect($('status')!.textContent).toContain('Paused on'));
    expect((await getSettings()).pausedHosts).toEqual(['chatgpt.com']);
  });

  it('resumes a paused site', async () => {
    withActiveTab('https://chatgpt.com/');
    await setSettings({ pausedHosts: ['chatgpt.com'] });
    mount();
    await waitFor(() => expect($('pause-site')!.textContent).toContain('Resume'));

    $('pause-site')!.click();

    await waitFor(() => expect($('pause-site')!.textContent).toContain('Pause on'));
    expect((await getSettings()).pausedHosts).toEqual([]);
  });

  it('offers no per-site control on an unsupported tab', async () => {
    withActiveTab('https://example.com/');
    mount();
    await ready();

    expect($('pause-site')).toBeNull();
  });
});

describe('the vault', () => {
  it('reports how many values are held', async () => {
    await put('[REDACTED_A_1]', SECRET, CHAT);
    mount();

    await waitFor(() => expect($('vault-count')!.textContent).toBe('1'));
  });

  it('never displays a stored value', async () => {
    await put('[REDACTED_A_1]', SECRET, CHAT);
    mount();

    await waitFor(() => expect($('vault-count')!.textContent).toBe('1'));
    expect(container.textContent).not.toContain(SECRET);
  });

  it('clears on request', async () => {
    await put('[REDACTED_A_1]', SECRET, CHAT);
    mount();
    await waitFor(() => expect($('vault-count')!.textContent).toBe('1'));

    $('vault-clear')!.click();

    await waitFor(() => expect($('vault-count')!.textContent).toBe('0'));
    expect(await size()).toBe(0);
  });

  it('disables the control when there is nothing to clear', async () => {
    mount();
    await waitFor(() =>
      expect(($('vault-clear') as HTMLButtonElement).disabled).toBe(true),
    );
  });
});

describe('the local-only claim', () => {
  it('states it plainly', async () => {
    // This sentence is the entire install-time pitch, shown where the user
    // looks when they wonder what the extension is doing.
    mount();
    await ready();

    expect(container.textContent).toContain('Nothing you type leaves this device');
  });
});
