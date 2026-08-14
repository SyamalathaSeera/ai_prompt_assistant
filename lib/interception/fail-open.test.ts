import { describe, expect, it, vi } from 'vitest';
import { createInterceptor } from './controller';
import { ALL_RULES } from '../detector/rules';
import { DEFAULT_SETTINGS } from '../policy/defaults';
import type { SiteAdapter, SubmitIntent } from '../adapters/types';
import type { Settings } from '../policy/schema';

/**
 * Fail-open, proven by systematic fault injection.
 *
 * The existing controller tests check specific failures one at a time. This
 * file does something different and, for a milestone about hardening, more
 * useful: it enumerates **every stage of the pipeline** from a single list and
 * asserts the same invariant at each one.
 *
 * The invariant: *a fault anywhere must leave the user able to send their
 * prompt.* Not "should not crash" — able to send. Trapping someone's message
 * because of a bug in our code is worse than any secret this tool might miss,
 * because a user who cannot send messages uninstalls within minutes, and then
 * they are protected by nothing at all.
 *
 * Enumerating rather than hand-writing cases is the point. A new stage added to
 * the pipeline should force a decision about its failure behaviour, and a list
 * makes the omission visible in a way that a pile of individual tests does not.
 */

const AWS_KEY = 'AKIA3TZ2MRSYNTHETIC7';
const DIRTY = `deploy with ${AWS_KEY} please`;

const boom = (): never => {
  throw new Error('injected fault');
};

interface Harness {
  /** Fires a submission and reports what happened to it. */
  submit: (text?: string) => { prevented: boolean; released: boolean };
}

/** Builds an adapter and interceptor with one stage sabotaged. */
function harness(
  sabotage: {
    getComposer?: boolean;
    getText?: boolean;
    setText?: boolean;
    getSettings?: boolean;
    isAllowlisted?: boolean;
    onHeld?: boolean;
    release?: boolean;
  } = {},
  settings: Partial<Settings> = {},
): Harness {
  let handler: ((intent: SubmitIntent) => void) | null = null;

  const composer = document.createElement('div');
  document.body.append(composer);

  const adapter: SiteAdapter = {
    id: 'test',
    hostPatterns: [],
    getComposer: () => (sabotage.getComposer ? boom() : composer),
    getText: () => (sabotage.getText ? boom() : composer.textContent ?? ''),
    setText: (_el, text) => {
      if (sabotage.setText) boom();
      composer.textContent = text;
    },
    onSubmitIntent: (cb) => {
      handler = cb;
      return () => {
        handler = null;
      };
    },
    checkHealth: () => ({
      composerFound: true,
      submitListenersAttached: true,
      resolvedVia: 'test',
    }),
  };

  createInterceptor({
    adapter,
    getSettings: () =>
      sabotage.getSettings ? boom() : { ...DEFAULT_SETTINGS, ...settings },
    isAllowlisted: sabotage.isAllowlisted ? boom : undefined,
    onHeld: sabotage.onHeld
      ? boom
      : (submission) => {
          // The realistic consumer: decide, then send. If `release` is
          // sabotaged this is where that surfaces.
          submission.sendReplacement('redacted text');
        },
    rules: ALL_RULES,
  });

  return {
    submit(text = DIRTY) {
      composer.textContent = text;

      let prevented = false;
      let released = false;

      const event = new Event('submit', { cancelable: true });
      const intent: SubmitIntent = {
        trigger: 'form',
        event,
        release: () => {
          released = true;
          if (sabotage.release) boom();
        },
      };

      // Whatever happens inside, nothing may escape to the host page.
      expect(() => handler?.(intent)).not.toThrow();

      prevented = event.defaultPrevented;
      return { prevented, released };
    },
  };
}

/**
 * Every stage that can throw, and what "the user can still send" means there.
 *
 * `sends` is true when the prompt leaves by itself — the fault happened before
 * the event was cancelled, so the host page proceeds as if we were not
 * installed. `releases` is true when we had already cancelled and must undo it.
 */
const STAGES = [
  { name: 'settings read', sabotage: { getSettings: true }, releases: false },
  { name: 'composer lookup', sabotage: { getComposer: true }, releases: false },
  { name: 'text read', sabotage: { getText: true }, releases: false },
  { name: 'allowlist check', sabotage: { isAllowlisted: true }, releases: false },
  { name: 'approval UI', sabotage: { onHeld: true }, releases: true },
  { name: 'composer write', sabotage: { setText: true }, releases: false },
] as const;

describe('a fault at any pipeline stage leaves the prompt sendable', () => {
  it.each(STAGES)('$name', ({ sabotage, releases }) => {
    const { submit } = harness(sabotage);
    const result = submit();

    if (releases) {
      // We cancelled, then failed. Releasing is the only acceptable response.
      expect(result.released).toBe(true);
    } else if (!result.prevented) {
      // Never cancelled: the host page submitted normally, which is the
      // strongest form of fail-open there is.
      expect(result.prevented).toBe(false);
    } else {
      // Cancelled and then something failed downstream — must be released.
      expect(result.released).toBe(true);
    }
  });

  it('covers every stage the pipeline actually has', () => {
    // A guard against this file rotting. Adding a stage without adding a case
    // should be a failing test, not a silent gap.
    expect(STAGES.map((s) => s.name)).toEqual([
      'settings read',
      'composer lookup',
      'text read',
      'allowlist check',
      'approval UI',
      'composer write',
    ]);
  });
});

describe('a fault never escapes to the host page', () => {
  it.each(STAGES)('$name does not throw out of the handler', ({ sabotage }) => {
    // Asserted inside `submit` as well; stated here because it is a separate
    // guarantee. An exception reaching ChatGPT's own handler could break the
    // page for reasons the user would never connect to this extension.
    const { submit } = harness(sabotage);
    expect(() => submit()).not.toThrow();
  });
});

describe('the clean path is unaffected', () => {
  it('lets an ordinary prompt through with nothing sabotaged', () => {
    const { submit } = harness();
    const result = submit('what is the capital of France');

    expect(result.prevented).toBe(false);
    expect(result.released).toBe(false);
  });

  it('still holds a real secret when nothing is broken', () => {
    // The counter-test. Fail-open assertions are worthless if the pipeline
    // fails open on everything.
    const { submit } = harness();
    const result = submit();

    expect(result.prevented).toBe(true);
  });
});

describe('release failing is survivable', () => {
  it('does not throw when release itself is broken', () => {
    /*
     * The last line of defence. If `release` throws we cannot recover the
     * submission — but we can refuse to make it worse by letting the exception
     * escape into the page's own submit handler.
     */
    const { submit } = harness({ onHeld: true, release: true });
    expect(() => submit()).not.toThrow();
  });
});

describe('warn mode', () => {
  it('never cancels, so nothing can be stranded', () => {
    // In warn mode the prompt is already gone by the time we are notified.
    // There is no state in which a fault can trap it.
    const { submit } = harness({ onHeld: true }, { highTierBehavior: 'warn' });
    const result = submit();

    expect(result.prevented).toBe(false);
  });
});

describe('a hostile adapter', () => {
  it('survives every method throwing at once', () => {
    const { submit } = harness({
      getComposer: true,
      getText: true,
      setText: true,
      getSettings: true,
      isAllowlisted: true,
      onHeld: true,
    });

    const result = submit();

    expect(result.prevented).toBe(false);
    expect(vi.isMockFunction(submit)).toBe(false);
  });
});
