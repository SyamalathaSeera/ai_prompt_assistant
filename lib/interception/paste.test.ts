import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPasteWatcher, MAX_PASTE_SCAN_LENGTH, type PasteRisk } from './paste';
import { DEFAULT_SETTINGS } from '../policy/defaults';
import type { Settings } from '../policy/schema';
import type { Disposer, PasteEvent, SiteAdapter } from '../adapters/types';

const DOTENV = [
  'NODE_ENV=production',
  'AWS_ACCESS_KEY_ID=AKIA3TZ2MRSYNTHETIC7',
  'DATABASE_URL=postgres://app:Tq7ZmW2rKp9x@db.internal:5432/orders',
].join('\n');

interface Harness {
  adapter: SiteAdapter;
  paste: (text: string) => void;
  pasteHandlerAttached: () => boolean;
}

function makeHarness(supportsPaste = true): Harness {
  let handler: ((paste: PasteEvent) => void) | null = null;

  const adapter: SiteAdapter = {
    id: 'fake',
    hostPatterns: ['https://fake.test/*'],
    getComposer: () => document.createElement('div'),
    getText: () => '',
    setText: () => {},
    onSubmitIntent: (): Disposer => () => {},
    checkHealth: () => ({
      composerFound: true,
      submitListenersAttached: true,
      resolvedVia: 'fake',
    }),
  };

  if (supportsPaste) {
    adapter.onPaste = (cb): Disposer => {
      handler = cb;
      return () => {
        handler = null;
      };
    };
  }

  return {
    adapter,
    paste: (text) => handler?.({ text, event: new Event('paste') as ClipboardEvent }),
    pasteHandlerAttached: () => handler !== null,
  };
}

function settings(patch: Partial<Settings> = {}): () => Settings {
  return () => ({ ...DEFAULT_SETTINGS, ...patch });
}

beforeEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('paste scanning', () => {
  it('reports secrets in a pasted .env', async () => {
    const h = makeHarness();
    let risk: PasteRisk | null = null;
    createPasteWatcher({
      adapter: h.adapter,
      getSettings: settings(),
      onRisk: (r) => (risk = r),
    });

    h.paste(DOTENV);
    await vi.waitFor(() => expect(risk).not.toBeNull());

    expect(risk!.blocking.map((f) => f.ruleId).sort()).toEqual([
      'aws.access_key_id',
      'db.connection_string_password',
    ]);
    expect(risk!.skippedForSize).toBe(false);
  });

  it('stays silent on clean text', async () => {
    const h = makeHarness();
    const onRisk = vi.fn();
    createPasteWatcher({ adapter: h.adapter, getSettings: settings(), onRisk });

    h.paste('function add(a, b) { return a + b; }');
    await new Promise((r) => setTimeout(r, 10));

    expect(onRisk).not.toHaveBeenCalled();
  });

  it('does not fire on low-tier findings alone', async () => {
    const h = makeHarness();
    const onRisk = vi.fn();
    createPasteWatcher({ adapter: h.adapter, getSettings: settings(), onRisk });

    h.paste('contact sarah.chen@northwind-labs.io');
    await new Promise((r) => setTimeout(r, 10));

    expect(onRisk).not.toHaveBeenCalled();
  });

  it('scans only the pasted chunk, not the whole composer', async () => {
    // Cheaper and more precise: the user is told about what they just pasted.
    const h = makeHarness();
    let risk: PasteRisk | null = null;
    createPasteWatcher({
      adapter: h.adapter,
      getSettings: settings(),
      onRisk: (r) => (risk = r),
    });

    h.paste('AWS_ACCESS_KEY_ID=AKIA3TZ2MRSYNTHETIC7');
    await vi.waitFor(() => expect(risk).not.toBeNull());

    expect(risk!.text).toBe('AWS_ACCESS_KEY_ID=AKIA3TZ2MRSYNTHETIC7');
  });

  it('respects an allowlisted value', async () => {
    const h = makeHarness();
    const onRisk = vi.fn();
    createPasteWatcher({
      adapter: h.adapter,
      getSettings: settings(),
      onRisk,
      isAllowlisted: (v) => v === 'AKIA3TZ2MRSYNTHETIC7',
    });

    h.paste('my key is AKIA3TZ2MRSYNTHETIC7');
    await new Promise((r) => setTimeout(r, 10));

    expect(onRisk).not.toHaveBeenCalled();
  });
});

describe('large pastes', () => {
  it('skips scanning above the cap instead of stalling the tab', async () => {
    // Skipping is safe because this is early warning, not the guarantee —
    // submit-time interception still scans the full prompt.
    const h = makeHarness();
    let risk: PasteRisk | null = null;
    createPasteWatcher({
      adapter: h.adapter,
      getSettings: settings(),
      onRisk: (r) => (risk = r),
    });

    h.paste('x'.repeat(MAX_PASTE_SCAN_LENGTH + 1));

    expect(risk).not.toBeNull();
    expect(risk!.skippedForSize).toBe(true);
    expect(risk!.blocking).toEqual([]);
  });

  it('still scales to a large-but-allowed paste', async () => {
    const h = makeHarness();
    let risk: PasteRisk | null = null;
    createPasteWatcher({
      adapter: h.adapter,
      getSettings: settings(),
      onRisk: (r) => (risk = r),
    });

    const filler = 'lorem ipsum dolor sit amet\n'.repeat(2000);
    h.paste(`${filler}AWS_ACCESS_KEY_ID=AKIA3TZ2MRSYNTHETIC7`);

    await vi.waitFor(() => expect(risk).not.toBeNull());
    expect(risk!.blocking.map((f) => f.ruleId)).toContain('aws.access_key_id');
  });

  it('returns from the paste handler synchronously', () => {
    // The scan is deferred to a macrotask so the paste lands and the caret
    // settles before any work happens, whatever the payload size.
    const h = makeHarness();
    const onRisk = vi.fn();
    createPasteWatcher({ adapter: h.adapter, getSettings: settings(), onRisk });

    h.paste(DOTENV);

    // Nothing has run yet — proof the scan is off the paste's critical path.
    expect(onRisk).not.toHaveBeenCalled();
  });
});

describe('settings', () => {
  it('does nothing when the extension is disabled', async () => {
    const h = makeHarness();
    const onRisk = vi.fn();
    createPasteWatcher({
      adapter: h.adapter,
      getSettings: settings({ enabled: false }),
      onRisk,
    });

    h.paste(DOTENV);
    await new Promise((r) => setTimeout(r, 10));

    expect(onRisk).not.toHaveBeenCalled();
  });

  it('does nothing when paste scanning is turned off', async () => {
    const h = makeHarness();
    const onRisk = vi.fn();
    createPasteWatcher({
      adapter: h.adapter,
      getSettings: settings({ scanOnPaste: false }),
      onRisk,
    });

    h.paste(DOTENV);
    await new Promise((r) => setTimeout(r, 10));

    expect(onRisk).not.toHaveBeenCalled();
  });

  it('is on by default, since paste is the moment of risk', () => {
    expect(DEFAULT_SETTINGS.scanOnPaste).toBe(true);
  });
});

describe('robustness', () => {
  it('returns a no-op disposer when the adapter cannot observe pastes', () => {
    const h = makeHarness(false);
    const dispose = createPasteWatcher({
      adapter: h.adapter,
      getSettings: settings(),
      onRisk: vi.fn(),
    });

    expect(() => dispose()).not.toThrow();
  });

  it('does not throw when getSettings fails', () => {
    const h = makeHarness();
    createPasteWatcher({
      adapter: h.adapter,
      getSettings: () => {
        throw new Error('storage unavailable');
      },
      onRisk: vi.fn(),
    });

    expect(() => h.paste(DOTENV)).not.toThrow();
  });

  it('detaches on dispose', async () => {
    const h = makeHarness();
    const onRisk = vi.fn();
    const dispose = createPasteWatcher({
      adapter: h.adapter,
      getSettings: settings(),
      onRisk,
    });

    dispose();
    expect(h.pasteHandlerAttached()).toBe(false);

    h.paste(DOTENV);
    await new Promise((r) => setTimeout(r, 10));
    expect(onRisk).not.toHaveBeenCalled();
  });
});
