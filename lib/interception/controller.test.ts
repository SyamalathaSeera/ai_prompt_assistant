import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createInterceptor, type HeldSubmission } from './controller';
import { DEFAULT_SETTINGS } from '../policy/defaults';
import type { Settings } from '../policy/schema';
import type { Disposer, SiteAdapter, SubmitIntent } from '../adapters/types';

/**
 * Interception tests.
 *
 * A fake adapter is used rather than the ChatGPT one so these test the
 * pipeline's decisions — hold, release, fail open — independently of any
 * host page's DOM.
 */

const AWS_KEY = 'AKIA3TZ2MRSYNTHETIC7';

interface Harness {
  adapter: SiteAdapter;
  fire: () => { event: Event; released: number };
  setComposerText: (text: string) => void;
  composerText: () => string;
}

function makeHarness(overrides: Partial<SiteAdapter> = {}): Harness {
  let text = '';
  let handler: ((intent: SubmitIntent) => void) | null = null;
  let released = 0;

  const composer = document.createElement('div');
  document.body.appendChild(composer);

  const adapter: SiteAdapter = {
    id: 'fake',
    hostPatterns: ['https://fake.test/*'],
    getComposer: () => composer,
    getText: () => text,
    setText: (_el, value) => {
      text = value;
    },
    onSubmitIntent: (cb): Disposer => {
      handler = cb;
      return () => {
        handler = null;
      };
    },
    checkHealth: () => ({
      composerFound: true,
      submitListenersAttached: true,
      resolvedVia: 'fake',
    }),
    ...overrides,
  };

  return {
    adapter,
    fire: () => {
      const event = new Event('submit', { bubbles: true, cancelable: true });
      released = 0;
      handler?.({ trigger: 'enter', event, release: () => (released += 1) });
      return { event, get released() { return released; } };
    },
    setComposerText: (value) => {
      text = value;
    },
    composerText: () => text,
  };
}

function settings(patch: Partial<Settings> = {}): () => Settings {
  return () => ({ ...DEFAULT_SETTINGS, ...patch });
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('clean prompts', () => {
  it('lets an ordinary prompt through untouched', () => {
    const h = makeHarness();
    h.setComposerText('Can you explain how promises work?');
    const onHeld = vi.fn();
    createInterceptor({ adapter: h.adapter, getSettings: settings(), onHeld });

    const { event } = h.fire();

    expect(event.defaultPrevented).toBe(false);
    expect(onHeld).not.toHaveBeenCalled();
  });

  it('ignores an empty composer', () => {
    const h = makeHarness();
    h.setComposerText('   ');
    const onHeld = vi.fn();
    createInterceptor({ adapter: h.adapter, getSettings: settings(), onHeld });

    expect(h.fire().event.defaultPrevented).toBe(false);
    expect(onHeld).not.toHaveBeenCalled();
  });

  it('does not hold on low-tier findings alone', () => {
    // Advisory PII must never block a submission.
    const h = makeHarness();
    h.setComposerText('email me at sarah.chen@northwind-labs.io');
    const onHeld = vi.fn();
    createInterceptor({ adapter: h.adapter, getSettings: settings(), onHeld });

    expect(h.fire().event.defaultPrevented).toBe(false);
    expect(onHeld).not.toHaveBeenCalled();
  });
});

describe('prompts containing secrets', () => {
  it('holds the submission and reports the findings', () => {
    const h = makeHarness();
    h.setComposerText(`AWS_ACCESS_KEY_ID=${AWS_KEY}`);
    let captured: HeldSubmission | null = null;
    createInterceptor({
      adapter: h.adapter,
      getSettings: settings(),
      onHeld: (s) => (captured = s),
    });

    const { event } = h.fire();

    expect(event.defaultPrevented).toBe(true);
    expect(captured).not.toBeNull();
    expect(captured!.held).toBe(true);
    expect(captured!.blocking.map((f) => f.ruleId)).toEqual(['aws.access_key_id']);
  });

  it('sends the original text when the user insists', () => {
    const h = makeHarness();
    h.setComposerText(`AWS_ACCESS_KEY_ID=${AWS_KEY}`);
    let captured: HeldSubmission | null = null;
    createInterceptor({
      adapter: h.adapter,
      getSettings: settings(),
      onHeld: (s) => (captured = s),
    });

    const fired = h.fire();
    captured!.sendOriginal();

    expect(fired.released).toBe(1);
    expect(h.composerText()).toBe(`AWS_ACCESS_KEY_ID=${AWS_KEY}`);
  });

  it('replaces the composer text then sends', () => {
    const h = makeHarness();
    h.setComposerText(`AWS_ACCESS_KEY_ID=${AWS_KEY}`);
    let captured: HeldSubmission | null = null;
    createInterceptor({
      adapter: h.adapter,
      getSettings: settings(),
      onHeld: (s) => (captured = s),
    });

    const fired = h.fire();
    captured!.sendReplacement('AWS_ACCESS_KEY_ID=[REDACTED_AWS_ACCESS_KEY_ID_1]');

    expect(h.composerText()).toBe('AWS_ACCESS_KEY_ID=[REDACTED_AWS_ACCESS_KEY_ID_1]');
    expect(fired.released).toBe(1);
  });

  it('leaves the composer alone when cancelled', () => {
    const h = makeHarness();
    const original = `AWS_ACCESS_KEY_ID=${AWS_KEY}`;
    h.setComposerText(original);
    let captured: HeldSubmission | null = null;
    createInterceptor({
      adapter: h.adapter,
      getSettings: settings(),
      onHeld: (s) => (captured = s),
    });

    const fired = h.fire();
    captured!.cancel();

    expect(fired.released).toBe(0);
    expect(h.composerText()).toBe(original);
  });

  it('suppresses an allowlisted value', () => {
    const h = makeHarness();
    h.setComposerText(`AWS_ACCESS_KEY_ID=${AWS_KEY}`);
    const onHeld = vi.fn();
    createInterceptor({
      adapter: h.adapter,
      getSettings: settings(),
      onHeld,
      isAllowlisted: (v) => v === AWS_KEY,
    });

    expect(h.fire().event.defaultPrevented).toBe(false);
    expect(onHeld).not.toHaveBeenCalled();
  });
});

describe('settings', () => {
  it('does nothing at all when disabled', () => {
    const h = makeHarness();
    h.setComposerText(`AWS_ACCESS_KEY_ID=${AWS_KEY}`);
    const onHeld = vi.fn();
    createInterceptor({
      adapter: h.adapter,
      getSettings: settings({ enabled: false }),
      onHeld,
    });

    expect(h.fire().event.defaultPrevented).toBe(false);
    expect(onHeld).not.toHaveBeenCalled();
  });

  it('does nothing on a paused host', () => {
    const h = makeHarness();
    h.setComposerText(`AWS_ACCESS_KEY_ID=${AWS_KEY}`);
    const onHeld = vi.fn();
    createInterceptor({
      adapter: h.adapter,
      getSettings: settings({ pausedHosts: [location.hostname] }),
      onHeld,
    });

    expect(h.fire().event.defaultPrevented).toBe(false);
    expect(onHeld).not.toHaveBeenCalled();
  });

  it('notifies without blocking in warn mode', () => {
    const h = makeHarness();
    h.setComposerText(`AWS_ACCESS_KEY_ID=${AWS_KEY}`);
    let captured: HeldSubmission | null = null;
    createInterceptor({
      adapter: h.adapter,
      getSettings: settings({ highTierBehavior: 'warn' }),
      onHeld: (s) => (captured = s),
    });

    const { event } = h.fire();

    expect(event.defaultPrevented).toBe(false);
    expect(captured!.held).toBe(false);
  });

  it('respects a disabled rule', () => {
    // A bare key, matched by exactly one rule, so disabling it is observable.
    const h = makeHarness();
    h.setComposerText(`my key is ${AWS_KEY}`);
    const onHeld = vi.fn();
    createInterceptor({
      adapter: h.adapter,
      getSettings: settings({ disabledRuleIds: ['aws.access_key_id'] }),
      onHeld,
    });

    expect(h.fire().event.defaultPrevented).toBe(false);
    expect(onHeld).not.toHaveBeenCalled();
  });

  it('still catches a key in a config line when the specific rule is disabled', () => {
    // Defense in depth, and worth pinning: `AWS_ACCESS_KEY_ID=AKIA…` is caught
    // by both the AWS rule and the generic secret-assignment rule. Turning off
    // one does not open a hole.
    const h = makeHarness();
    h.setComposerText(`AWS_ACCESS_KEY_ID=${AWS_KEY}`);
    let captured: HeldSubmission | null = null;
    createInterceptor({
      adapter: h.adapter,
      getSettings: settings({ disabledRuleIds: ['aws.access_key_id'] }),
      onHeld: (s) => (captured = s),
    });

    expect(h.fire().event.defaultPrevented).toBe(true);
    expect(captured!.blocking.map((f) => f.ruleId)).toEqual(['env.secret_assignment']);
  });

  it('picks up a settings change without re-registering', () => {
    const h = makeHarness();
    h.setComposerText(`AWS_ACCESS_KEY_ID=${AWS_KEY}`);
    let enabled = false;
    const onHeld = vi.fn();
    createInterceptor({
      adapter: h.adapter,
      getSettings: () => ({ ...DEFAULT_SETTINGS, enabled }),
      onHeld,
    });

    expect(h.fire().event.defaultPrevented).toBe(false);

    enabled = true;
    expect(h.fire().event.defaultPrevented).toBe(true);
  });
});

describe('fail open', () => {
  // Every one of these is a bug in our code. None may cost the user the
  // ability to send their message.

  it('proceeds when getComposer throws', () => {
    const h = makeHarness({
      getComposer: () => {
        throw new Error('DOM exploded');
      },
    });
    createInterceptor({ adapter: h.adapter, getSettings: settings(), onHeld: vi.fn() });

    expect(h.fire().event.defaultPrevented).toBe(false);
  });

  it('proceeds when getComposer returns null', () => {
    const h = makeHarness({ getComposer: () => null });
    createInterceptor({ adapter: h.adapter, getSettings: settings(), onHeld: vi.fn() });

    expect(h.fire().event.defaultPrevented).toBe(false);
  });

  it('proceeds when getText throws', () => {
    const h = makeHarness({
      getText: () => {
        throw new Error('read failed');
      },
    });
    createInterceptor({ adapter: h.adapter, getSettings: settings(), onHeld: vi.fn() });

    expect(h.fire().event.defaultPrevented).toBe(false);
  });

  it('proceeds when getSettings throws', () => {
    const h = makeHarness();
    createInterceptor({
      adapter: h.adapter,
      getSettings: () => {
        throw new Error('storage unavailable');
      },
      onHeld: vi.fn(),
    });

    expect(h.fire().event.defaultPrevented).toBe(false);
  });

  it('proceeds when the allowlist predicate throws', () => {
    const h = makeHarness();
    h.setComposerText('an ordinary question');
    createInterceptor({
      adapter: h.adapter,
      getSettings: settings(),
      onHeld: vi.fn(),
      isAllowlisted: () => {
        throw new Error('hash failed');
      },
    });

    expect(h.fire().event.defaultPrevented).toBe(false);
  });

  it('releases the submission when the approval UI throws', () => {
    // The prompt was already cancelled by this point, so doing nothing would
    // strand it permanently — the worst possible outcome.
    const h = makeHarness();
    h.setComposerText(`AWS_ACCESS_KEY_ID=${AWS_KEY}`);
    createInterceptor({
      adapter: h.adapter,
      getSettings: settings(),
      onHeld: () => {
        throw new Error('modal crashed');
      },
    });

    const fired = h.fire();

    expect(fired.event.defaultPrevented).toBe(true);
    expect(fired.released).toBe(1);
  });

  it('never throws out of the handler, whatever fails', () => {
    const h = makeHarness({
      getComposer: () => {
        throw new Error('boom');
      },
    });
    createInterceptor({ adapter: h.adapter, getSettings: settings(), onHeld: vi.fn() });

    expect(() => h.fire()).not.toThrow();
  });
});

describe('teardown', () => {
  it('detaches on dispose', () => {
    const h = makeHarness();
    h.setComposerText(`AWS_ACCESS_KEY_ID=${AWS_KEY}`);
    const onHeld = vi.fn();
    const dispose = createInterceptor({
      adapter: h.adapter,
      getSettings: settings(),
      onHeld,
    });

    dispose();
    h.fire();

    expect(onHeld).not.toHaveBeenCalled();
  });
});
