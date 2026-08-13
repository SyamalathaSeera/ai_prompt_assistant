import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createLiveScanner, SCAN_BUDGET_MS, type RiskState } from './live-scan';
import { DEFAULT_SETTINGS } from '../policy/defaults';
import type { Settings } from '../policy/schema';
import type { Disposer, SiteAdapter } from '../adapters/types';

const AWS_KEY = 'AKIA3TZ2MRSYNTHETIC7';
const DEBOUNCE = 20;

interface Harness {
  adapter: SiteAdapter;
  type: (text: string) => void;
  scanCount: () => number;
}

function makeHarness(supportsInput = true): Harness {
  let text = '';
  let scans = 0;
  let handler: (() => void) | null = null;

  const adapter: SiteAdapter = {
    id: 'fake',
    hostPatterns: ['https://fake.test/*'],
    getComposer: () => document.createElement('div'),
    getText: () => {
      scans += 1;
      return text;
    },
    setText: () => {},
    onSubmitIntent: (): Disposer => () => {},
    checkHealth: () => ({
      composerFound: true,
      submitListenersAttached: true,
      resolvedVia: 'fake',
    }),
  };

  if (supportsInput) {
    adapter.onInput = (cb): Disposer => {
      handler = cb;
      return () => {
        handler = null;
      };
    };
  }

  return {
    adapter,
    type: (value) => {
      text = value;
      handler?.();
    },
    scanCount: () => scans,
  };
}

function settings(patch: Partial<Settings> = {}): () => Settings {
  return () => ({ ...DEFAULT_SETTINGS, ...patch });
}

const settle = () => new Promise((r) => setTimeout(r, DEBOUNCE * 3));

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('risk levels', () => {
  it('reports high for a secret', async () => {
    const h = makeHarness();
    let state: RiskState | null = null;
    createLiveScanner({
      adapter: h.adapter,
      getSettings: settings(),
      onRiskChange: (s) => (state = s),
      debounceMs: DEBOUNCE,
    });

    h.type(`AWS_ACCESS_KEY_ID=${AWS_KEY}`);
    await settle();

    expect(state!.level).toBe('high');
    expect(state!.highCount).toBeGreaterThan(0);
  });

  it('reports low for advisory PII only', async () => {
    const h = makeHarness();
    let state: RiskState | null = null;
    createLiveScanner({
      adapter: h.adapter,
      getSettings: settings(),
      onRiskChange: (s) => (state = s),
      debounceMs: DEBOUNCE,
    });

    h.type('reach me at sarah.chen@northwind-labs.io');
    await settle();

    expect(state!.level).toBe('low');
    expect(state!.highCount).toBe(0);
    expect(state!.lowCount).toBe(1);
  });

  it('stays silent on clean text', async () => {
    const h = makeHarness();
    const onRiskChange = vi.fn();
    createLiveScanner({
      adapter: h.adapter,
      getSettings: settings(),
      onRiskChange,
      debounceMs: DEBOUNCE,
    });

    h.type('how do promises work?');
    await settle();

    expect(onRiskChange).not.toHaveBeenCalled();
  });

  it('returns to none when the secret is deleted', async () => {
    const h = makeHarness();
    const seen: RiskState[] = [];
    createLiveScanner({
      adapter: h.adapter,
      getSettings: settings(),
      onRiskChange: (s) => seen.push(s),
      debounceMs: DEBOUNCE,
    });

    h.type(`AWS_ACCESS_KEY_ID=${AWS_KEY}`);
    await settle();
    h.type('AWS_ACCESS_KEY_ID=');
    await settle();

    expect(seen.map((s) => s.level)).toEqual(['high', 'none']);
  });

  it('resets to none when the composer is cleared', async () => {
    const h = makeHarness();
    const seen: RiskState[] = [];
    createLiveScanner({
      adapter: h.adapter,
      getSettings: settings(),
      onRiskChange: (s) => seen.push(s),
      debounceMs: DEBOUNCE,
    });

    h.type(`AWS_ACCESS_KEY_ID=${AWS_KEY}`);
    await settle();
    h.type('   ');
    await settle();

    expect(seen[seen.length - 1]!.level).toBe('none');
  });
});

describe('debounce', () => {
  it('scans once for a burst of keystrokes', async () => {
    const h = makeHarness();
    createLiveScanner({
      adapter: h.adapter,
      getSettings: settings(),
      onRiskChange: vi.fn(),
      debounceMs: DEBOUNCE,
    });

    for (const partial of ['a', 'ab', 'abc', 'abcd', 'abcde']) h.type(partial);
    await settle();

    // One read of the composer, not five — this is what keeps typing smooth.
    expect(h.scanCount()).toBe(1);
  });

  it('does not scan before the debounce elapses', async () => {
    const h = makeHarness();
    createLiveScanner({
      adapter: h.adapter,
      getSettings: settings(),
      onRiskChange: vi.fn(),
      debounceMs: DEBOUNCE,
    });

    h.type('hello');
    expect(h.scanCount()).toBe(0);
  });
});

describe('caching', () => {
  it('does not re-emit when the text is unchanged', async () => {
    const h = makeHarness();
    const onRiskChange = vi.fn();
    createLiveScanner({
      adapter: h.adapter,
      getSettings: settings(),
      onRiskChange,
      debounceMs: DEBOUNCE,
    });

    h.type(`AWS_ACCESS_KEY_ID=${AWS_KEY}`);
    await settle();
    expect(onRiskChange).toHaveBeenCalledTimes(1);

    // Same text again — e.g. an arrow key or a formatting-only edit.
    h.type(`AWS_ACCESS_KEY_ID=${AWS_KEY}`);
    await settle();
    expect(onRiskChange).toHaveBeenCalledTimes(1);
  });

  it('does not re-emit when the level and counts are unchanged', async () => {
    // Two different drafts, both one high finding. The badge would look
    // identical, so re-rendering it would only make it flicker.
    const h = makeHarness();
    const onRiskChange = vi.fn();
    createLiveScanner({
      adapter: h.adapter,
      getSettings: settings(),
      onRiskChange,
      debounceMs: DEBOUNCE,
    });

    h.type(`my key is ${AWS_KEY}`);
    await settle();
    h.type(`my key is ${AWS_KEY} thanks`);
    await settle();

    expect(onRiskChange).toHaveBeenCalledTimes(1);
  });

  it('re-emits when the finding count changes', async () => {
    const h = makeHarness();
    const seen: RiskState[] = [];
    createLiveScanner({
      adapter: h.adapter,
      getSettings: settings(),
      onRiskChange: (s) => seen.push(s),
      debounceMs: DEBOUNCE,
    });

    h.type(`key ${AWS_KEY}`);
    await settle();
    h.type(`key ${AWS_KEY} and AKIA7NE4UV2QSYNTHET1`);
    await settle();

    expect(seen.map((s) => s.highCount)).toEqual([1, 2]);
  });
});

describe('performance budget', () => {
  it('does not report a slow scan on an ordinary draft', async () => {
    const h = makeHarness();
    const onSlowScan = vi.fn();
    createLiveScanner({
      adapter: h.adapter,
      getSettings: settings(),
      onRiskChange: vi.fn(),
      onSlowScan,
      debounceMs: DEBOUNCE,
    });

    h.type(`${'lorem ipsum dolor sit amet '.repeat(400)}${AWS_KEY}`);
    await settle();

    expect(onSlowScan).not.toHaveBeenCalled();
  });

  it('keeps the budget as the PRD states it', () => {
    expect(SCAN_BUDGET_MS).toBe(50);
  });

  it('never passes text to the slow-scan reporter', async () => {
    // A diagnostic that leaks the thing it is diagnosing would be worse than
    // no diagnostic at all.
    const h = makeHarness();
    const calls: unknown[] = [];
    createLiveScanner({
      adapter: h.adapter,
      getSettings: settings(),
      onRiskChange: vi.fn(),
      onSlowScan: (info) => calls.push(info),
      debounceMs: DEBOUNCE,
    });

    h.type(`AWS_ACCESS_KEY_ID=${AWS_KEY}`);
    await settle();

    for (const call of calls) {
      expect(JSON.stringify(call)).not.toContain(AWS_KEY);
      expect(Object.keys(call as object).sort()).toEqual(['durationMs', 'length']);
    }
  });
});

describe('settings and robustness', () => {
  it('reports none when disabled', async () => {
    const h = makeHarness();
    const seen: RiskState[] = [];
    createLiveScanner({
      adapter: h.adapter,
      getSettings: settings({ enabled: false }),
      onRiskChange: (s) => seen.push(s),
      debounceMs: DEBOUNCE,
    });

    h.type(`AWS_ACCESS_KEY_ID=${AWS_KEY}`);
    await settle();

    expect(seen).toEqual([]);
  });

  it('does not throw when getSettings fails', async () => {
    const h = makeHarness();
    createLiveScanner({
      adapter: h.adapter,
      getSettings: () => {
        throw new Error('storage unavailable');
      },
      onRiskChange: vi.fn(),
      debounceMs: DEBOUNCE,
    });

    expect(() => h.type('hello')).not.toThrow();
    await settle();
  });

  it('does not throw when getText fails', async () => {
    const h = makeHarness();
    h.adapter.getText = () => {
      throw new Error('read failed');
    };
    createLiveScanner({
      adapter: h.adapter,
      getSettings: settings(),
      onRiskChange: vi.fn(),
      debounceMs: DEBOUNCE,
    });

    expect(() => h.type('hello')).not.toThrow();
    await settle();
  });

  it('returns a no-op disposer when the adapter cannot observe input', () => {
    const h = makeHarness(false);
    const dispose = createLiveScanner({
      adapter: h.adapter,
      getSettings: settings(),
      onRiskChange: vi.fn(),
    });

    expect(() => dispose()).not.toThrow();
  });

  it('cancels a pending scan on dispose', async () => {
    const h = makeHarness();
    const onRiskChange = vi.fn();
    const dispose = createLiveScanner({
      adapter: h.adapter,
      getSettings: settings(),
      onRiskChange,
      debounceMs: DEBOUNCE,
    });

    h.type(`AWS_ACCESS_KEY_ID=${AWS_KEY}`);
    dispose();
    await settle();

    expect(onRiskChange).not.toHaveBeenCalled();
    expect(h.scanCount()).toBe(0);
  });
});
