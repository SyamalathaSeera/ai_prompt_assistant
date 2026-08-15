import { describe, expect, it, vi } from 'vitest';
import { createPanelStore } from './panel-store';
import { createRiskStore } from './risk-store';
import { createRefineStore } from './refine-store';
import { createClarifyStore } from './clarify-store';

/**
 * The subscription contract, asserted for every store.
 *
 * These four stores are written independently and have drifted apart in the
 * details — two rebuild the listener set on unsubscribe, two delete from it —
 * but they all make the same promise to their consumers. This file is where
 * that promise is checked once, for all of them, so a fifth store cannot ship
 * with a subtly different one.
 *
 * The case that matters is the one that actually broke:
 *
 *   subscribe(fn)   // effect run 1
 *   subscribe(fn)   // effect run 2, same function
 *   dispose1()      // cleanup from run 1
 *
 * With listeners kept in a `Set` and removed by identity, both subscriptions
 * collapsed into one entry and the first cleanup deleted it — leaving the
 * component silently unsubscribed from a store that was working perfectly.
 * State advanced, nothing rendered, and nothing threw. It happened on the
 * welcome page (0.6.0.1) and was caught only because a test asserted on the
 * rendered UI rather than on the store.
 */

/** Each store, reduced to what this contract needs: subscribe, and a change. */
const STORES = [
  {
    name: 'panel-store',
    make: () => {
      const store = createPanelStore({});
      return {
        subscribe: store.subscribe.bind(store),
        change: () => store.present(submission()),
      };
    },
  },
  {
    name: 'risk-store',
    make: () => {
      const store = createRiskStore({ onApplyRedaction: () => {} });
      return {
        subscribe: store.subscribe.bind(store),
        change: () => store.setRisk('high', [], 'some text'),
      };
    },
  },
  {
    name: 'refine-store',
    make: () => {
      const store = createRefineStore({
        getDraft: () => 'a draft',
        applyToComposer: () => {},
      });
      return {
        subscribe: store.subscribe.bind(store),
        change: () => store.setStyle('concise'),
      };
    },
  },
  {
    name: 'clarify-store',
    make: () => {
      const store = createClarifyStore({
        getDraft: () => 'a draft',
        applyToComposer: () => {},
      });
      return {
        subscribe: store.subscribe.bind(store),
        // `decline` reaches `set` without needing a model or a conversation.
        change: () => store.decline(),
      };
    },
  },
] as const;

/** A minimal held submission — only enough for `present` to accept it. */
function submission() {
  return {
    text: 'nothing sensitive',
    findings: [],
    blocking: [],
    held: true,
    sendOriginal: () => {},
    sendReplacement: () => {},
    cancel: () => {},
  };
}

describe.each(STORES)('$name', ({ make }) => {
  it('notifies a subscriber', () => {
    const { subscribe, change } = make();
    const listener = vi.fn();

    subscribe(listener);
    change();

    expect(listener).toHaveBeenCalled();
  });

  it('stops notifying after dispose', () => {
    const { subscribe, change } = make();
    const listener = vi.fn();

    subscribe(listener)();
    change();

    expect(listener).not.toHaveBeenCalled();
  });

  it('treats the same function subscribed twice as two subscriptions', () => {
    /*
     * The regression. Without a per-subscription identity these collapse into
     * one entry, and disposing the first silently removes the second as well.
     */
    const { subscribe, change } = make();
    const listener = vi.fn();

    const disposeFirst = subscribe(listener);
    subscribe(listener);

    disposeFirst();
    change();

    expect(listener, 'the surviving subscription was removed too').toHaveBeenCalled();
  });

  it('delivers once per live subscription', () => {
    const { subscribe, change } = make();
    const listener = vi.fn();

    subscribe(listener);
    subscribe(listener);
    change();

    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('survives disposing the same subscription twice', () => {
    // Effect cleanups can run more than once during teardown.
    const { subscribe, change } = make();
    const listener = vi.fn();

    const dispose = subscribe(listener);
    dispose();
    expect(() => dispose()).not.toThrow();

    change();
    expect(listener).not.toHaveBeenCalled();
  });
});
